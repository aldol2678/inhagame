# INHA WORLD · F10/F11 Realtime identity security investigation

**STATUS: DRAFT / ISOLATED CI EXPERIMENT. NOT DEPLOYABLE.**

This directory contains the isolated server registration API, signed-frame verifier, candidate SQL, and executable security tests. It does **not** integrate into the current World client or deploy a server. Existing `world:campus:*` and `world:room:*` still allow legacy traffic, so **the Production spoofing defect remains OPEN**.

## What the security workflow proves

- `npm run check` and `npm test`: 30 synthetic HTTP/crypto/authorization regression cases.
- The GitHub Actions *local* Supabase stack runs all public development migrations, then applies `sql/RI_TRUSTED_IDENTITY_ISOLATED_CANDIDATE.sql` **only to that throwaway database**, never the GAMES Production database or a hosted Supabase project.
- An independent Node 24 WebSocket client connects to the actual local Supabase Realtime server (`phx_join`), checks pre-registration denial, registered subscriber admission, unregistered subscriber denial, forbidden client broadcasting, and trusted database Broadcast delivery; it also checks reconnect after revocation.
- Synthetic Auth users and browser sessions are created only in the throwaway local stack. Logs emit no tokens, private keys, or credentials.

**Gates are fail-closed:** a missing Realtime server, absent `psql`, configuration drift, any surprising allow, or missing DB broadcast must FAIL or be reported UNKNOWN. No mock can substitute for the WebSocket acceptance check.

## Local execution

From the repository root, with Supabase CLI, Docker and PostgreSQL client installed:

```bash
cd tools/security/ri-identity
npm run check
npm test
# from repository root, only against disposable local Supabase:
supabase start
node tools/security/ri-identity/tests/local-realtime-ci.mjs
supabase stop --no-backup
```

## Security and release boundaries

- No service key, JWT, endpoint override or credentials in the repository or Actions artifacts.
- This SQL is a CI-only candidate fixture, **not** a forward migration and not approved for Production application. The public migration lineage is not the Production lineage.
- RLS authorization at channel join does **not** revoke existing WebSockets. F01–F09 admin-kick defects are separate.
- A signed packet proves control of a private key, not truthful coordinates or automatic privilege to grant rewards.
- The client must use only server-derived rosters for social names, chat, GM markers, player cards and reports. The current client does not yet consume this experimental model.
- Before merging a real fix: integrate with `world-online.js`, `room-session.js`, `supabase-realtime-transport.js`, `NetworkManager`, sign-in/out, guest/room paths; run browser/mobile and F01–F11 regression and obtain explicit Production rollout approval.
- Draft PR stays unmerged and unactivated until integration and security review pass.

Sources: [Realtime protocol](https://supabase.com/docs/guides/realtime/protocol), [Realtime RLS](https://supabase.com/docs/guides/realtime/authorization), [database broadcast](https://supabase.com/docs/guides/realtime/broadcast).
