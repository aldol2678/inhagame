#!/bin/sh
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git cat-file -e "${base}^{commit}" 2>/dev/null || base=HEAD^
git diff --quiet "$base" HEAD -- . \
  ':(exclude,glob)tests/**' \
  ':(exclude,glob)docs/**' \
  ':(exclude,glob)**/*.md' \
  ':(exclude)playwright.config.ts' \
  ':(exclude)playwright.config.cjs'
