# INHAGAME public source

Source-visible local development package for Classic, World, Grow, InduckUp and Survival.
All rights reserved. Public visibility does not grant an open-source license.

This package contains an isolated Supabase baseline and synthetic local fixtures.
Configure a disposable local backend; no production credentials or integration are supplied.
The default client endpoint is http://127.0.0.1:54321 and the public key is an inert placeholder.

Character/equipment artwork is represented by independently generated QA cuboids and square sprites.
Music defaults to silence. Personal staff markers are not preconfigured.

Run `bash scripts/public-ci.sh` for local static/unit checks. Run `bash scripts/public-db.sh`
with Docker and Supabase CLI 2.117.0 for a disposable local database replay.
See NOTICE.md, SECURITY.md, CONTRIBUTING.md and PUBLIC_PUSH_STOP.md.
