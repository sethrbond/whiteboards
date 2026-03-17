# TaskBoard (Whiteboards)

AI-powered personal productivity system with task management, brainstorming, and proactive AI assistance.

## Tech Stack

Vanilla JS, Vite, Supabase (cloud sync + auth), Claude API (AI features).

## Getting Started

```sh
npm install
npm run dev      # local dev server
npm test         # run test suite
npm run build    # production build
```

## Module Architecture

The app is split into 34 source modules in `src/`:

| Module | Purpose |
|---|---|
| `actions.js` | Data-action delegation, handles all static HTML interactions |
| `ai.js` | AI API layer — communication with Claude API, rate limiting |
| `ai-context.js` | AI persona, context building, memory management, action execution |
| `app.js` | Entry point — wires all modules together, initializes Supabase |
| `auth.js` | Authentication, onboarding, and session management |
| `brainstorm.js` | Brainstorm/dump input, file attachments, AI-powered task extraction |
| `calendar.js` | Week/month calendar views |
| `chat.js` | AI chat panel, messaging, history |
| `command-palette.js` | Search/command palette, shortcut help, AI palette queries |
| `constants.js` | Shared constants (storage keys, colors, defaults, `MS_PER_DAY`) |
| `dashboard.js` | Dashboard rendering, sidebar, project view, archive, sorting |
| `data.js` | Data layer — persistence, CRUD, undo system, task queries, archive management |
| `dates.js` | Pure date utilities (formatting, relative time, natural-language date parsing) |
| `error-handler.js` | Global error handling and recovery UI |
| `escalation.js` | Deadline escalation engine, overdue pileups, stuck tasks, escalation banners |
| `events.js` | Event delegation, keyboard shortcuts, modal management |
| `focus.js` | Focus mode overlay and timer |
| `init.js` | Initialization helpers, tooltips, throttle wrappers, modal observer, offline banner |
| `migrations.js` | Schema versioning and data migration system |
| `notifications.js` | Desktop notification scheduling, permission management, preferences |
| `parsers.js` | Pure parsing/transformation functions for AI responses and user input |
| `proactive.js` | Proactive AI — orchestrator for briefing, planning, nudges modules |
| `proactive-briefing.js` | Daily briefing generation, end-of-day reflection, AI status items |
| `proactive-nudges.js` | Smart nudges, stuck task detection, reflections, check-ins |
| `proactive-planning.js` | Day planning, snoozing, replanning, workload analysis, auto-rebalancing |
| `quick-add.js` | Quick capture, slash commands, AI task enhancement, bulk actions |
| `settings.js` | Settings panel, project CRUD, data import/export, AI memory management |
| `sync.js` | Cloud sync, conflict detection, sync UI |
| `task-editor.js` | Task rendering, editing, inline commands, dependencies, CRUD modals |
| `templates.js` | Task templates CRUD, built-in workflow templates |
| `ui-helpers.js` | Toasts, subtask progress, tags, bulk mode, smart date inputs, notifications |
| `utils.js` | Pure utility functions (escaping, sanitization, string similarity, ID generation) |
| `weekly-review.js` | Weekly review rendering and AI review generation |
| `window-api.js` | Exposes module functions on `window` for dynamic HTML handlers |

## Tests

- Framework: Vitest (with jsdom environment)
- ~2800 tests across 48 test files in `src/__tests__/`
- Run: `npm test` or `npx vitest run`

## Key Patterns

- **Factory functions with dependency injection**: Most modules export a `create*` factory that receives dependencies as a `deps` object, enabling easy testing and decoupling.
- **Event delegation via `data-action`**: UI events are handled through delegated listeners that match `data-action` attributes on elements.
- **Dual storage: localStorage + Supabase sync**: Data is persisted locally first, then synced to Supabase when the user is authenticated.
