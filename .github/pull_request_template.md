## What and why

<!-- One purpose per PR. Link the related issue if there is one. -->

## Checklist

- [ ] CI `verify` is green (locally: `bash scripts/public-ci.sh`; database changes also `bash scripts/public-db.sh`)
- [ ] No credentials, personal data, production configuration or private operational artifacts
- [ ] Database change: new forward migration only (existing migrations are never edited), version greater than the newest one, no Production-only objects
- [ ] Tests added or updated for behavior changes
