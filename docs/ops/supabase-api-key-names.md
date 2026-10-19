# Supabase server key names (GAMES)

Names only. Never put key values in this repository, PR text, logs or chat.

| Consumer | New key (preferred) | Legacy fallback | Header sent |
|---|---|---|---|
| Vercel `apps/world/api/world-collection-book.js`, `world-fishing.js` | env `SUPABASE_SECRET_KEY` (`sb_secret_...`) | env `SUPABASE_SERVICE_ROLE_KEY` (JWT) | `sb_secret_`: `apikey` only · JWT: `apikey` + `Authorization: Bearer` |
| Cloud Run NPC AI container (`apps/world/npc-factory/npc-ai-cloud-run.mjs`: quota, quest, relationship stores) | env `SUPABASE_SECRET_KEY` | env `SUPABASE_SERVICE_ROLE_KEY` | same rule (`npc-factory/supabase-server-key.mjs`) |
| Edge Functions `ranked-run-start`, `ranked-run-finish`, `world-duck-observe`, `verify-inha-mail` | runtime-injected `SUPABASE_SECRET_KEYS["default"]`, `SUPABASE_PUBLISHABLE_KEYS["default"]` (JSON) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | supabase-js client (`supabase/functions/_shared/supabase-keys.ts`) |

Rules

- Selection order is new key first, legacy second. Unsetting `SUPABASE_SECRET_KEY` rolls a
  server back to the legacy key without a code change (while the legacy key is still enabled).
- A publishable key in a server slot, or a key containing whitespace, is rejected
  (`SUPABASE_SERVER_KEY_INVALID`). No key at all fails closed (`SUPABASE_SERVER_KEY_REQUIRED`,
  Cloud Run: `NPC_AI_PRODUCTION_CONFIG_REQUIRED`). Errors carry only these fixed codes.
- `sb_secret_` keys are not JWTs: never send them as `Authorization: Bearer`
  (https://supabase.com/docs/guides/api/api-keys, "Known limitations").
- Preview deployments must not receive the production secret. Use a Supabase branch/staging
  key or a short-lived Preview-only secret that is deleted after verification.
