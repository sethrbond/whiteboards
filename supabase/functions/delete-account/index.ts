// Supabase Edge Function: Delete Account (App Store requirement)
// Permanently deletes a user's account and all associated data.
// Deploy: supabase functions deploy delete-account

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const ALLOWED_ORIGINS = new Set([
  'https://www.whiteboards.dev',
  'https://whiteboards.dev',
])

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('origin') || ''
  return ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.whiteboards.dev'
}

serve(async (req: Request) => {
  const corsOrigin = getCorsOrigin(req)
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  // Get user from auth header
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Create client with user's token to verify identity
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  try {
    // Delete user data
    const { error: dataErr } = await adminClient.from('user_data').delete().eq('user_id', user.id)
    if (dataErr) console.error('[DELETE] user_data error:', dataErr.message)

    // Delete push subscriptions
    const { error: pushErr } = await adminClient.from('push_subscriptions').delete().eq('user_id', user.id)
    if (pushErr) console.error('[DELETE] push_subscriptions error:', pushErr.message)

    // Delete the auth user account
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('[DELETE ACCOUNT]', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
