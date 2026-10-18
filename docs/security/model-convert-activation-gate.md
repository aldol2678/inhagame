# Model Convert API | pre-activation security gate

## State at audit (2026-10-19 KST)
- The connected production Vercel project did not list `MODEL_CONVERT_ENABLED`, `MODEL_CONVERT_CLOUD_RUN_URL`, or `MODEL_CONVERT_PROXY_SECRET`. Existing code consequently returned `enabled: false`; production endpoint reachability was **not** independently verified.
- This change **does not activate** model conversion or set any production variables.

## Server-side guard
- POST requests are accepted only with a verified **non-anonymous** Supabase user token belonging to an explicitly allowlisted UUID.
- `Origin` is only an additional browser-origin check, never authorization.
- The proxy fails closed unless all required settings exist: `MODEL_CONVERT_ENABLED=1`, HTTPS `MODEL_CONVERT_CLOUD_RUN_URL`, a strong `MODEL_CONVERT_PROXY_SECRET`, `MODEL_CONVERT_ALLOWED_USER_IDS` (comma-separated Supabase Auth UUIDs), `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`.
- Binary/ASCII FBX signatures, strict content type and filename, maximum 25 MiB input and output, and GLB version/length are checked. The proxy never exposes arbitrary upstream error messages.

## Implemented on Draft PR #428 (not deployed)
- The World Editor FBX path now obtains the already-signed-in user's public Supabase session access token and forwards it as a Bearer token. The server verifies that user and its explicit operator UUID allowlist. GLB import remains browser-local and unaffected.
- The conversion proxy makes a fail-closed quota claim before calling Cloud Run. A new **unapplied** SQL migration implements an atomic rolling 1-hour cap: at most **3 conversions per operator** and **20 conversions globally**. The claim table holds only user UUID and timestamp, retained for up to 2 days.
- Activation additionally requires `SUPABASE_SERVICE_ROLE_KEY` stored server-side only. Never expose it, the operator allowlist, or `MODEL_CONVERT_PROXY_SECRET` in browser code.

## Remaining blockers: do not enable yet
1. **Apply and validate the new SQL migration to the actual production-bound Supabase instance, after approval**, and verify a service-role RPC call succeeds while `anon` and `authenticated` cannot invoke it. No database migration was executed in this PR.
2. **Cloud Run cost controls**: independently verify ingress/IAM, secret authorization, concurrency and instance caps. A DB job-count budget limits calls but not per-job CPU cost, request floods before authentication, or cloud infrastructure billing.
3. **Editor experience**: verified logged-in operator access requires a signed-in Supabase session in the same origin. Staff must sign in on the hub first. Invalid/guest sessions fail closed; perform staging end-to-end login and FBX conversion tests.
4. **CI/staging and rollout**: run targeted tests, migration lint and staging security smoke before setting any production conversion variables. Confirm the rollback path and keep the feature disabled until signoff.

## Checks
```sh
node --test apps/world/tests/model-convert-api-security.test.mjs
node --test apps/world/tests/model-converter.test.mjs apps/world/tests/editor-model-import.test.mjs apps/world/tests/editor-model-convert-auth.test.mjs
node .github/ci/migration-lint.mjs
node .github/ci/migration-contract-lint.mjs
```
