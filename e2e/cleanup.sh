#!/usr/bin/env bash
# Closes whatever the e2e run left open and deletes its branch. Never fails the job.
set -uo pipefail

created="$RUNNER_TEMP/e2e-created"
if [[ -f "$created" ]]; then
  while read -r number; do
    [[ -n "$number" ]] || continue
    gh api -X PATCH "repos/$GH_REPO/issues/$number" -f state=closed > /dev/null \
      && echo "Closed #$number" \
      || echo "::warning::Could not close #$number"
  done < "$created"
fi

if [[ -n "${BRANCH:-}" ]]; then
  gh api -X DELETE "repos/$GH_REPO/git/refs/heads/$BRANCH" > /dev/null \
    && echo "Deleted branch $BRANCH" \
    || echo "::warning::Could not delete branch $BRANCH"
fi
exit 0
