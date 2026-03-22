// Supabase Edge Function: Push Notifications (v8)
// Sends smart push notifications to users at appropriate times.
// Called by pg_cron at 9am, 2pm, and 6pm (or external cron).
//
// Deploy: supabase functions deploy push-notify
// Secrets: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Schedule:
//   SELECT cron.schedule('push-morning', '0 9 * * *', $$ ... $$);
//   SELECT cron.schedule('push-midday', '0 14 * * *', $$ ... $$);
//   SELECT cron.schedule('push-evening', '0 18 * * *', $$ ... $$);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const CRON_SECRET = Deno.env.get('CRON_SECRET')

// Web Push requires these for VAPID auth
const VAPID_SUBJECT = 'mailto:hello@whiteboards.dev'

serve(async (req: Request) => {
  // Auth check
  const authHeader = req.headers.get('authorization') || ''
  let authorized = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  if (!authorized) {
    try {
      const body = await req.clone().json()
      if (CRON_SECRET && body.secret && body.secret === CRON_SECRET) authorized = true
    } catch { /* */ }
  }
  if (!authorized) return new Response('Unauthorized', { status: 401 })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing config' }), { status: 500 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = new Date()
  const hour = now.getHours()
  const today = now.toISOString().slice(0, 10)
  const results: { userId: string; sent: boolean; type: string; error?: string }[] = []

  try {
    // Get all push subscriptions with user data
    const { data: subs, error: subsError } = await sb
      .from('push_subscriptions')
      .select('user_id, endpoint, subscription')

    if (subsError) throw subsError
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: 'No subscriptions', results: [] }))
    }

    // Get user data for all subscribed users
    const userIds = [...new Set(subs.map((s: any) => s.user_id))]
    const { data: users, error: usersError } = await sb
      .from('user_data')
      .select('user_id, tasks, projects, daily_plan')
      .in('user_id', userIds)

    if (usersError) throw usersError
    const userMap = new Map((users || []).map((u: any) => [u.user_id, u]))

    for (const sub of subs) {
      const user = userMap.get(sub.user_id)
      if (!user) continue

      const tasks = user.tasks || []
      const active = tasks.filter((t: any) => t.status !== 'done' && !t.archived)
      const overdue = active.filter((t: any) => t.dueDate && t.dueDate < today)
      const dueToday = active.filter((t: any) => t.dueDate === today)

      let notification: { title: string; body: string; tag: string; taskId?: string } | null = null

      // Morning (8-10am): Focus Card summary
      if (hour >= 8 && hour < 10) {
        const plan = user.daily_plan
        if (plan?.date === today && plan.blocks?.length) {
          const firstBlock = plan.blocks.find((b: any) => !b.isBreak)
          const firstTask = firstBlock?.tasks?.[0]
          const taskData = firstTask ? tasks.find((t: any) => t.id === firstTask.id) : null
          notification = {
            title: 'Your day is planned',
            body: taskData
              ? `Start with: ${taskData.title}${firstTask.why ? ' — ' + firstTask.why : ''}`
              : plan.narrative?.slice(0, 100) || `${active.length} tasks ready`,
            tag: `morning-${today}`,
            taskId: taskData?.id,
          }
        } else if (active.length > 0) {
          notification = {
            title: overdue.length ? `${overdue.length} overdue` : 'Good morning',
            body: overdue.length
              ? `${overdue[0].title} is ${Math.floor((Date.now() - new Date(overdue[0].dueDate).getTime()) / 86400000)} days overdue`
              : `${active.length} tasks across ${new Set(active.map((t: any) => t.project)).size} boards`,
            tag: `morning-${today}`,
            taskId: overdue[0]?.id,
          }
        }
      }

      // Midday (1-3pm): Progress check-in
      if (hour >= 13 && hour < 15) {
        const completed = tasks.filter((t: any) =>
          t.status === 'done' && t.completedAt?.slice(0, 10) === today
        )
        if (completed.length > 0 || dueToday.length > 0) {
          const remaining = dueToday.filter((t: any) => t.status !== 'done')
          notification = {
            title: completed.length
              ? `${completed.length} done today`
              : `${remaining.length} due today`,
            body: remaining.length > 0
              ? `${remaining[0].title} is due today${remaining[0].estimatedMinutes ? ' (~' + remaining[0].estimatedMinutes + 'm)' : ''}`
              : 'All tasks due today are complete!',
            tag: `midday-${today}`,
            taskId: remaining[0]?.id,
          }
        }
      }

      // Evening (5-7pm): End-of-day wrap-up
      if (hour >= 17 && hour < 19) {
        const completed = tasks.filter((t: any) =>
          t.status === 'done' && t.completedAt?.slice(0, 10) === today
        )
        if (completed.length > 0) {
          notification = {
            title: `${completed.length} tasks completed today`,
            body: `${active.length} still active. Tomorrow's looking ${overdue.length > 2 ? 'busy' : 'manageable'}.`,
            tag: `evening-${today}`,
          }
        }
      }

      if (!notification) {
        results.push({ userId: sub.user_id, sent: false, type: 'no-notification' })
        continue
      }

      // Send push notification
      try {
        const subscription = JSON.parse(sub.subscription)
        const payload = JSON.stringify({
          title: notification.title,
          body: notification.body,
          tag: notification.tag,
          taskId: notification.taskId || null,
          url: '/',
        })

        // Web Push with VAPID — using the web-push compatible format
        // For production, use a web-push library. This is the minimal implementation.
        const pushResult = await fetch(subscription.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL': '86400',
            // Note: Full VAPID signing requires crypto operations.
            // In production, use the web-push npm package or Deno equivalent.
            // For now, this structure supports the subscription endpoint format.
          },
          body: payload,
        })

        if (pushResult.status === 410 || pushResult.status === 404) {
          // Subscription expired — remove it
          await sb.from('push_subscriptions')
            .delete()
            .eq('user_id', sub.user_id)
            .eq('endpoint', sub.endpoint)
          results.push({ userId: sub.user_id, sent: false, type: 'expired-removed' })
        } else {
          results.push({ userId: sub.user_id, sent: true, type: notification.tag })
        }
      } catch (pushErr: any) {
        results.push({ userId: sub.user_id, sent: false, type: 'push-error', error: pushErr.message })
      }
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }

  return new Response(JSON.stringify({
    timestamp: now.toISOString(),
    hour,
    results,
  }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
