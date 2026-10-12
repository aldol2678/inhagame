# Jeongseok public access activation candidate

Status: PREPARATION / EXACT-HEAD CI AND PRODUCTION READBACK PENDING

## Scope and provenance

- Base: `787252c754ed1b3741b58264f6e58f088c387deb` on `main`.
- Runtime changes are limited to the shipped Jeongseok constructor selecting `serverAccessAvailable: true` and its visual-preview hostname boundary.
- Guest entry into the public lobby is free. The inner lobby and B1 continue to require a fresh, account-bound server grant, a real gate crossing, and ongoing expiry/revocation checks.
- The public-side guide NPC remains the only client purchase entry point. Guests must log in to purchase; confirmed Inha-mail accounts remain free. The confirmed visitor pass remains 100 Induck Coin for 86,400 seconds.
- The resolver stays CLOSED when unconfigured. Jeongseok visual preview accepts only exact browser hostnames `localhost`, `127.0.0.1` and `[::1]`. Public Vercel aliases, the Production domain and misleading loopback-like names cannot bypass the inner gate with query parameters. The global preview-host flag and all other features remain unchanged.
- Active browser cases now verify SHA-256 equality between the main response actually loaded by the browser and the checkout source. Only the explicit loopback CLOSED regression overrides the constructor, then restores the route.
- No SQL, migration, server authority, wallet, price, inner grant/session policy, collision or workflow changes are included. All other pending/HOLD candidates remain excluded.

## Release gates

- Complete the separately authorized server/database contract and permission preflight before releasing the client, leaving gate/product COMING_SOON. After the client deployment is verified, activate the gate and product together atomically within that separate authorization. Public/disposable migration success does not establish Production state.
- Required Public CI and both existing Jeongseok browser workflows must pass on the final candidate. Their commands and thresholds are unchanged.
- Verify the resulting main SHA, matching READY Production deployment, served main constructor, free guest lobby, protected inner gate and absence of new runtime errors. Do not record completion before these readbacks.
- Local unit/static success does not claim browser, physical-device, or Production QA. Production purchase testing requires its own authorization.

## Rollback boundary

- First disable gate/product state within the approved server scope. If the public lobby must close too, use a protected hotfix that sets the Jeongseok constructor to false while retaining the exact-loopback hostname guard.
- Historical CLOSED-client base: `787252c754ed1b3741b58264f6e58f088c387deb`. A whole-deployment rollback to that base also restores its broader Vercel preview classification, so it is not the preferred feature-close operation; reassess its exposed aliases before considering it for a broader incident.
- Preserve all existing pass receipts, entitlements and wallet history; client rollback is never authorization to delete them.
