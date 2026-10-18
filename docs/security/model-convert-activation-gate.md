# Model Convert API | pre-activation security gate

## State at audit (2026-10-19 KST)
- The connected production Vercel project did not list `MODEL_CONVERT_ENABLED`, `MODEL_CONVERT_CLOUD_RUN_URL`, or `MODEL_CONVERT_PROXY_SECRET`. Existing code consequently returned `enabled: false`; production endpoint reachability was **not** independently verified.
- This change **does not activate** model conversion or set any production variables.

## Server-side guard
- POST requests are accepted only with a verified **non-anonymous** Supabase user token belonging to an explicitly allowlisted UUID.
- `Origin` is only an additional browser-origin check, never authorization.
- The proxy fails closed unless all required settings exist: `MODEL_CONVERT_ENABLED=1`, HTTPS `MODEL_CONVERT_CLOUD_RUN_URL`, a strong `MODEL_CONVERT_PROXY_SECRET`, `MODEL_CONVERT_ALLOWED_USER_IDS` (comma-separated Supabase Auth UUIDs), `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`.
- Binary/ASCII FBX signatures, strict content type and filename, maximum 25 MiB input and output, and GLB version/length are checked. The proxy never exposes arbitrary upstream error messages.

## Remaining blockers: do not enable yet
1. The current browser World Editor FBX importer does **not** send the required `Authorization: Bearer ...` header. Integrate the user's authenticated Supabase session into the editor only after staff/operator access control is specified. Do not embed a privileged token, service-role key, or converter secret in browser code.
2. Add **durable per-operator rate limits and global conversion budgets** (e.g., server-side atomic quota + Cloud Run concurrency / instance caps). In-process counters are not sufficient on Vercel serverless. This PR does not claim rate limiting is complete.
3. Confirm Cloud Run ingress/IAM and the converter secret independently; rotate any inadvertently exposed credentials.
4. Run targeted tests and staging smoke/abuse-budget checks before changing production flags. Keep production disabled unless every gate passes.

## Checks
```sh
node --test apps/world/tests/model-convert-api-security.test.mjs
node --test apps/world/tests/model-converter.test.mjs apps/world/tests/editor-model-import.test.mjs
```
