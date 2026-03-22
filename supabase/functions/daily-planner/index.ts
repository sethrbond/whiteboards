// Supabase Edge Function: Daily Planner (v7)
// Runs on schedule (6am daily) to auto-plan each user's day.
// Reads tasks/projects from user_data, calls Claude, writes plan back.
//
// Deploy: supabase functions deploy daily-planner
// Set secrets:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
//
// Schedule via pg_cron:
//   SELECT cron.schedule('daily-plan', '0 6 * * *',
//     $$SELECT net.http_post('https://puchukhutxtilniqtlnt.supabase.co/functions/v1/daily-planner',
//       '{"secret":"YOUR_CRON_SECRET"}', '{"Content-Type":"application/json"}'::jsonb)$$);
//
// Or trigger via external cron (GitHub Actions, cron-job.org):
//   POST /functions/v1/daily-planner with Authorization: Bearer <service_role_key>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')
const MODEL = 'claude-sonnet-4-5-20250514'

serve(async (req: Request) => {
  // Auth: accept service role key via Authorization header or cron secret in body
  const authHeader = req.headers.get('authorization') || ''
  let authorized = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`

  if (!authorized && req.method === 'POST') {
    try {
      const body = await req.clone().json()
      if (CRON_SECRET && body.secret && body.secret === CRON_SECRET) authorized = true
    } catch { /* */ }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing secrets' }), { status: 500 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const today = new Date().toISOString().slice(0, 10)
  const results: { userId: string; taskCount: number; error?: string }[] = []

  try {
    // Get all users who have tasks
    const { data: users, error: usersError } = await sb
      .from('user_data')
      .select('user_id, tasks, projects, ai_memory, settings, daily_plan')

    if (usersError) throw usersError
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ message: 'No users found', results: [] }))
    }

    for (const user of users) {
      try {
        // Skip if already planned today
        if (user.daily_plan?.date === today) {
          results.push({ userId: user.user_id, taskCount: 0, error: 'already planned' })
          continue
        }

        const tasks = user.tasks || []
        const projects = user.projects || []
        const active = tasks.filter((t: any) =>
          t.status !== 'done' && !t.archived
        )

        if (active.length === 0) {
          results.push({ userId: user.user_id, taskCount: 0, error: 'no active tasks' })
          continue
        }

        // Build task list for AI
        const taskList = active.slice(0, 50).map((t: any) => {
          const proj = projects.find((p: any) => p.id === t.project)
          const blocked = t.blockedBy && t.blockedBy.length > 0 ? 'BLOCKED' : ''
          const age = t.createdAt
            ? Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000)
            : 0
          const subtaskProgress = t.subtasks?.length
            ? `${t.subtasks.filter((s: any) => s.done).length}/${t.subtasks.length}`
            : ''
          return `${t.id}|${t.title}|${t.priority}|${t.status}|${t.dueDate || ''}|${proj?.name || ''}|${blocked}|${t.estimatedMinutes || 0}|${subtaskProgress}|${age}`
        }).join('\n')

        // Build memory context
        const memories = (user.ai_memory || []).slice(0, 10)
        const memContext = memories.length
          ? '\nUSER PATTERNS:\n' + memories.map((m: any) => `- ${m.text}`).join('\n')
          : ''

        const prompt = `You are a sharp, direct productivity partner. Plan this user's day and write a brief.
${memContext}

Today: ${today}

ALL ACTIVE TASKS (id|title|priority|status|due|project|blocked|estimate|subtask_progress|age):
${taskList}

RULES:
- Pick 3-6 tasks. Realistic, not a wish list.
- ALWAYS include overdue + due-today tasks
- Consider energy: harder tasks earlier, lighter tasks later
- Skip BLOCKED tasks
- If total estimated time exceeds 6 hours, cut tasks
- Copy task IDs exactly

TIME BLOCKS:
- Group tasks into 2-4 time blocks by project
- Each block: label, time range, project name
- Include a lunch break
- Order by energy: urgent/hard first

Return ONLY this JSON:
{
  "narrative": "2-4 sentence brief about what matters today",
  "blocks": [
    { "label": "Morning Focus", "time": "9am – 12pm", "projectName": "Board name", "isBreak": false, "tasks": [{"id": "task_id", "why": "8 words max"}] },
    { "label": "Lunch", "time": "12pm – 1pm", "isBreak": true, "tasks": [] }
  ],
  "followUps": [
    { "taskId": "id", "message": "Deadline passed — need to follow up?" }
  ]
}`

        // Call Claude
        const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!aiResponse.ok) {
          const errText = await aiResponse.text()
          results.push({ userId: user.user_id, taskCount: 0, error: `AI error: ${aiResponse.status}` })
          console.error(`AI error for ${user.user_id}:`, errText)
          continue
        }

        const aiResult = await aiResponse.json()
        const content = aiResult.content?.[0]?.text || ''
        const cleaned = content.replace(/```json?\s*/g, '').replace(/```/g, '').trim()
        const plan = JSON.parse(cleaned)

        // Validate task IDs exist
        const taskIds = new Set(tasks.map((t: any) => t.id))
        if (plan.blocks) {
          plan.blocks.forEach((b: any) => {
            if (b.tasks) b.tasks = b.tasks.filter((p: any) => taskIds.has(p.id))
          })
        }

        const totalPlanned = plan.blocks
          ? plan.blocks.reduce((s: number, b: any) => s + (b.tasks?.length || 0), 0)
          : 0

        // Write plan back to user_data
        const { error: updateError } = await sb
          .from('user_data')
          .update({
            daily_plan: {
              date: today,
              narrative: plan.narrative || '',
              blocks: plan.blocks || [],
              followUps: plan.followUps || [],
              generatedAt: new Date().toISOString(),
            },
          })
          .eq('user_id', user.user_id)

        if (updateError) {
          results.push({ userId: user.user_id, taskCount: totalPlanned, error: `DB error: ${updateError.message}` })
        } else {
          results.push({ userId: user.user_id, taskCount: totalPlanned })
        }
      } catch (userErr: any) {
        results.push({ userId: user.user_id, taskCount: 0, error: userErr.message })
        console.error(`Failed for user ${user.user_id}:`, userErr)
      }
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }

  return new Response(JSON.stringify({
    date: today,
    usersProcessed: results.length,
    results,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
