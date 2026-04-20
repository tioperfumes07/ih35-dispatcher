#!/usr/bin/env bash
# Stage all, commit if needed, push to origin (used by Cursor stop hook + npm run git:sync).
# Opt out: touch `.cursor/AUTO_GIT_SYNC_OFF` in repo root.

set +e
ROOT="${CURSOR_PROJECT_DIR:-$PWD}"
cd "$ROOT" 2>/dev/null || exit 0
[ -d .git ] || exit 0
[ -f .cursor/AUTO_GIT_SYNC_OFF ] && exit 0

git remote get-url origin >/dev/null 2>&1 || exit 0

git add -A
if git diff --cached --quiet; then
  exit 0
fi

BR=$(git branch --show-current 2>/dev/null)
[ -n "$BR" ] || BR=main

MSG="chore(agent): auto-sync $(date -u +%Y-%m-%dT%H:%MZ)"
git commit -m "$MSG" || exit 0

git push origin "$BR"
exit 0
