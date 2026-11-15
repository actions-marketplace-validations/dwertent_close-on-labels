#!/usr/bin/env bash
# Creates the issues and the pull request the e2e workflow runs the action on.
# Writes their numbers to $GITHUB_OUTPUT and to a file that cleanup.sh reads.
set -euo pipefail

tag="run $GITHUB_RUN_ID.$GITHUB_RUN_ATTEMPT"
created="$RUNNER_TEMP/e2e-created"
: > "$created"

for label in e2e-a e2e-b e2e-keep; do
  gh label create "$label" --color ededed --description "Used by the e2e workflow" --force
done

new_issue() {
  local name=$1
  shift
  local args=(-f "title=[e2e] $name ($tag)" -f "body=Created by the e2e workflow. Safe to ignore.")
  local label
  for label in "$@"; do args+=(-f "labels[]=$label"); done
  local number
  number=$(gh api "repos/$GH_REPO/issues" "${args[@]}" --jq .number)
  echo "$number" >> "$created"
  echo "$name=$number" >> "$GITHUB_OUTPUT"
  echo "Created issue #$number for case $name"
}

new_issue or_hit e2e-a
new_issue and_miss e2e-a
new_issue and_hit e2e-a e2e-b
new_issue not_blocked e2e-a e2e-keep
new_issue expr_hit e2e-b
new_issue file_rule e2e-a e2e-b
new_issue dry_run e2e-a
new_issue wrong_target e2e-a
new_issue no_match

# A pull request needs a branch with at least one commit of its own.
branch="e2e/run-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
base=$(gh api "repos/$GH_REPO" --jq .default_branch)
sha=$(gh api "repos/$GH_REPO/git/ref/heads/$base" --jq .object.sha)
gh api "repos/$GH_REPO/git/refs" -f "ref=refs/heads/$branch" -f "sha=$sha" > /dev/null
echo "branch=$branch" >> "$GITHUB_OUTPUT"
gh api -X PUT "repos/$GH_REPO/contents/e2e/marker-$GITHUB_RUN_ID.txt" \
  -f "message=e2e marker ($tag)" \
  -f "content=$(printf 'e2e' | base64)" \
  -f "branch=$branch" > /dev/null

pr=$(gh api "repos/$GH_REPO/pulls" \
  -f "title=[e2e] pr ($tag)" \
  -f "body=Created by the e2e workflow. Safe to ignore." \
  -f "head=$branch" \
  -f "base=$base" \
  --jq .number)
echo "$pr" >> "$created"
gh api "repos/$GH_REPO/issues/$pr/labels" -f "labels[]=e2e-a" > /dev/null
echo "pr=$pr" >> "$GITHUB_OUTPUT"
echo "Created pull request #$pr"
