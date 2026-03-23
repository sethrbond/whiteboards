// Supabase Edge Function: AI Proxy
// Proxies requests to Anthropic API with server-side API key
// Deploy: supabase functions deploy ai-proxy --no-verify-jwt
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// v2 — Per-IP rate limiting, token budget caps, request validation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Config ──────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20241022',
  'claude-sonnet-4-5-20250514',
  'claude-sonnet-4-6-20250627',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
])

const RATE_LIMIT_HOUR = 60     // max requests per IP per rolling hour
const RATE_LIMIT_DAY = 300     // max requests per IP per rolling day
const MAX_MESSAGES = 20        // max messages in a conversation
const MAX_SYSTEM_CHARS = 16000  // max system prompt length
const MAX_MESSAGE_CHARS = 60000 // max single message length (chunked brainstorm needs room)
const MAX_TOKENS_NORMAL = 16384 // max_tokens cap for non-streaming
const MAX_TOKENS_STREAM = 16384 // max_tokens cap for streaming (matched to normal — no reason to limit)

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const ALLOWED_ORIGINS = new Set([
  'https://www.whiteboards.dev',
  'https://whiteboards.dev',
  ...(Deno.env.get('ALLOW_DEV_ORIGINS') === 'true' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
])

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.whiteboards.dev',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type, anthropic-version, apikey, x-user-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// ── In-memory rate limit store ──────────────────────────────────────────────
// Edge Function instances persist across requests for a while, so this works
// as a best-effort rate limiter. Not perfect (new instances start fresh) but
// good enough to stop casual abuse without needing a database round-trip.

interface RateBucket {
  timestamps: number[]
}

const rateLimitMap = new Map<string, RateBucket>()

// Clean up stale entries every 5 minutes to prevent memory leaks
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60 * 1000

function cleanupStaleEntries() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now

  const cutoff = now - DAY_MS
  for (const [ip, bucket] of rateLimitMap) {
    bucket.timestamps = bucket.timestamps.filter(t => t > cutoff)
    if (bucket.timestamps.length === 0) {
      rateLimitMap.delete(ip)
    }
  }
}

/**
 * Check rate limits for an IP. Returns null if OK, or an error Response if limited.
 */
function checkRateLimit(ip: string, req: Request): Response | null {
  cleanupStaleEntries()

  const now = Date.now()
  const bucket = rateLimitMap.get(ip) || { timestamps: [] }

  // Prune timestamps older than 24h
  bucket.timestamps = bucket.timestamps.filter(t => t > now - DAY_MS)

  const hourAgo = now - HOUR_MS
  const hourCount = bucket.timestamps.filter(t => t > hourAgo).length
  const dayCount = bucket.timestamps.length

  // Check hourly limit
  if (hourCount >= RATE_LIMIT_HOUR) {
    const oldestInHour = bucket.timestamps.filter(t => t > hourAgo).sort((a, b) => a - b)[0]
    const retryInMs = oldestInHour + HOUR_MS - now
    const retryMinutes = Math.ceil(retryInMs / 60000)

    console.warn(`[RATE LIMIT] IP ${ip} hit hourly limit (${hourCount}/${RATE_LIMIT_HOUR}). Retry in ${retryMinutes}m.`)

    return new Response(
      JSON.stringify({
        error: {
          type: 'rate_limit',
          message: `Rate limit exceeded. You've made ${hourCount} requests this hour (max ${RATE_LIMIT_HOUR}). Try again in ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'}.`,
        },
      }),
      {
        status: 429,
        headers: {
          ...getCorsHeaders(req),
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(retryInMs / 1000)),
        },
      }
    )
  }

  // Check daily limit
  if (dayCount >= RATE_LIMIT_DAY) {
    const oldestInDay = bucket.timestamps.sort((a, b) => a - b)[0]
    const retryInMs = oldestInDay + DAY_MS - now
    const retryMinutes = Math.ceil(retryInMs / 60000)

    console.warn(`[RATE LIMIT] IP ${ip} hit daily limit (${dayCount}/${RATE_LIMIT_DAY}). Retry in ${retryMinutes}m.`)

    return new Response(
      JSON.stringify({
        error: {
          type: 'rate_limit',
          message: `Daily rate limit exceeded. You've made ${dayCount} requests today (max ${RATE_LIMIT_DAY}). Try again in ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'}.`,
        },
      }),
      {
        status: 429,
        headers: {
          ...getCorsHeaders(req),
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(retryInMs / 1000)),
        },
      }
    )
  }

  // Record this request
  bucket.timestamps.push(now)
  rateLimitMap.set(ip, bucket)

  return null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number, req?: Request): Response {
  const cors = req ? getCorsHeaders(req) : { 'Access-Control-Allow-Origin': 'https://www.whiteboards.dev', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  return new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { ...cors, 'Content-Type': 'application/json' } }
  )
}

function getClientIP(req: Request): string {
  // Use rightmost X-Forwarded-For value (set by trusted proxy, not spoofable)
  const xff = req.headers.get('x-forwarded-for')
  const xffIp = xff ? xff.split(',').pop()?.trim() : undefined
  return (
    xffIp ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  )
}

/**
 * Extract text length from a message content field.
 * Content can be a string or an array of content blocks.
 */
function getMessageLength(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let total = 0
    for (const block of content) {
      if (typeof block === 'string') total += block.length
      else if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
        total += block.text.length
      }
      // Image blocks etc. are not counted toward the character limit
    }
    return total
  }
  return 0
}

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: getCorsHeaders(req) })
  }

  // Reject requests from non-allowed origins
  const origin = req.headers.get('origin') || ''
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Use user's own API key if provided, otherwise fall back to server key
  const userApiKey = req.headers.get('x-user-api-key')
  const apiKeyToUse = userApiKey || ANTHROPIC_API_KEY

  if (!apiKeyToUse) {
    return jsonError('API key not configured on server', 500, req)
  }

  // ── Rate limiting ───────────────────────────────────────────────────────
  const clientIP = getClientIP(req)
  const rateLimitResponse = checkRateLimit(clientIP, req)
  if (rateLimitResponse) return rateLimitResponse

  // ── Parse and validate ──────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400, req)
  }

  const { stream, model, messages, system, max_tokens, temperature } = body

  // Required fields
  if (!model || !messages) {
    return jsonError('Missing model or messages', 400, req)
  }

  // Model allowlist
  if (!ALLOWED_MODELS.has(model as string)) {
    return jsonError(
      `Model "${model}" is not allowed. Approved models: ${[...ALLOWED_MODELS].join(', ')}`,
      400, req
    )
  }

  // Message count limit
  if (!Array.isArray(messages)) {
    return jsonError('messages must be an array', 400, req)
  }
  if (messages.length > MAX_MESSAGES) {
    return jsonError(
      `Too many messages (${messages.length}). Maximum is ${MAX_MESSAGES}. Try starting a new conversation.`,
      400, req
    )
  }

  // System prompt length
  if (system != null) {
    const systemLength = typeof system === 'string'
      ? system.length
      : Array.isArray(system)
        ? system.reduce((acc: number, block: unknown) => {
            if (typeof block === 'string') return acc + block.length
            if (block && typeof block === 'object' && 'text' in block && typeof (block as Record<string, unknown>).text === 'string') {
              return acc + ((block as Record<string, string>).text).length
            }
            return acc
          }, 0)
        : 0

    if (systemLength > MAX_SYSTEM_CHARS) {
      return jsonError(
        `System prompt too long (${systemLength} chars). Maximum is ${MAX_SYSTEM_CHARS}.`,
        400, req
      )
    }
  }

  // Individual message length
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg && typeof msg === 'object' && 'content' in msg) {
      const len = getMessageLength(msg.content)
      if (len > MAX_MESSAGE_CHARS) {
        return jsonError(
          `Message ${i + 1} is too long (${len} chars). Maximum is ${MAX_MESSAGE_CHARS} per message.`,
          400, req
        )
      }
    }
  }

  // Cap max_tokens — users with own API key get higher limits (their bill)
  const isStream = !!stream
  const tokenCap = userApiKey ? 64000 : (isStream ? MAX_TOKENS_STREAM : MAX_TOKENS_NORMAL)
  let finalMaxTokens = typeof max_tokens === 'number' ? max_tokens : tokenCap
  if (finalMaxTokens > tokenCap) finalMaxTokens = tokenCap

  // ── Forward to Anthropic ────────────────────────────────────────────────
  try {
    const anthropicBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: finalMaxTokens,
      stream: isStream,
      ...(system != null ? { system } : {}),
      ...(typeof temperature === 'number' ? { temperature: Math.min(Math.max(temperature, 0), 1) } : {}),
    }

    // Audit log
    console.log(`[REQ] ${clientIP} model=${model} stream=${!!stream} msgs=${messages?.length} max_tokens=${finalMaxTokens}`)

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKeyToUse,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    })

    if (isStream) {
      return new Response(anthropicResp.body, {
        status: anthropicResp.status,
        headers: {
          ...getCorsHeaders(req),
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    }

    const result = await anthropicResp.json()
    return new Response(JSON.stringify(result), {
      status: anthropicResp.status,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[PROXY ERROR]', err)
    return jsonError('An error occurred processing your request. Please try again.', 500, req)
  }
})
