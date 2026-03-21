# Deployment Guide

## Prerequisites
- Node.js 18+
- Supabase project (with auth enabled)
- Vercel account (for hosting)
- Apple Developer account ($99/yr) for iOS App Store
- Google Play Console account ($25) for Android

## Environment Variables

### Local Development (.env)
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON=your-anon-key
```

### Supabase Edge Function Secrets
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set CRON_SECRET=your-random-secret
supabase secrets set VAPID_PRIVATE_KEY=your-vapid-private-key
supabase secrets set VAPID_PUBLIC_KEY=your-vapid-public-key
```

## Database Setup

Run these SQL files in the Supabase SQL Editor:

1. `supabase/rls_user_data.sql` — Creates user_data table with RLS
2. `supabase/push_subscriptions.sql` — Creates push_subscriptions table + daily_plan column

## Edge Function Deployment

```bash
# Deploy AI proxy
supabase functions deploy ai-proxy --no-verify-jwt

# Deploy daily planner (runs at 6am)
supabase functions deploy daily-planner

# Deploy push notifications (runs 3x/day)
supabase functions deploy push-notify
```

## Cron Schedules (pg_cron)

Run in Supabase SQL Editor:
```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Daily planner at 6am UTC
SELECT cron.schedule('daily-plan', '0 6 * * *',
  $$SELECT net.http_post(
    'https://your-project.supabase.co/functions/v1/daily-planner',
    '{"secret":"your-cron-secret"}'::jsonb,
    '{"Content-Type":"application/json"}'::jsonb
  )$$
);

-- Push notifications: morning 9am, midday 2pm, evening 6pm UTC
SELECT cron.schedule('push-morning', '0 9 * * *',
  $$SELECT net.http_post(
    'https://your-project.supabase.co/functions/v1/push-notify',
    '{"secret":"your-cron-secret"}'::jsonb,
    '{"Content-Type":"application/json"}'::jsonb
  )$$
);

SELECT cron.schedule('push-midday', '0 14 * * *',
  $$SELECT net.http_post(
    'https://your-project.supabase.co/functions/v1/push-notify',
    '{"secret":"your-cron-secret"}'::jsonb,
    '{"Content-Type":"application/json"}'::jsonb
  )$$
);

SELECT cron.schedule('push-evening', '0 18 * * *',
  $$SELECT net.http_post(
    'https://your-project.supabase.co/functions/v1/push-notify',
    '{"secret":"your-cron-secret"}'::jsonb,
    '{"Content-Type":"application/json"}'::jsonb
  )$$
);
```

## Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

Save the output and set as Supabase secrets (see above).
Store the public key in the app — users need it to subscribe to push.

## Capacitor Native Build

```bash
# Build web app
npm run build

# Sync to native projects
npx cap sync

# Open in Xcode (iOS)
npx cap open ios

# Open in Android Studio
npx cap open android
```

## Vercel Deployment

Push to `main` branch — Vercel auto-deploys from GitHub.
Headers and rewrites configured in `vercel.json`.
