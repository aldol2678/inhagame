#!/bin/sh
# Keep the original entrypoint usable in Vercel project settings.
exec node ./vercel-ignore.mjs
