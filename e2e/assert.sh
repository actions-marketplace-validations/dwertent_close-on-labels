#!/usr/bin/env bash
# Checks the state GitHub reports and the outputs the action set, for every e2e case.
set -uo pipefail

failures=0

fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}

# expect <case> <actual> <expected> <what>
expect() {
  if [[ "$2" == "$3" ]]; then
    echo "  ok: $4 = '$2'"
  else
    fail "$1: expected $4 to be '$3' but got '$2'"
  fi
}

# check <case> <number> <outputs json> <state> <state_reason> <closed> <matched-rule> <matched-labels>
check() {
  local name=$1 number=$2 outputs=$3
  echo "Case $name (#$number)"
  local item
  item=$(gh api "repos/$GH_REPO/issues/$number")
  expect "$name" "$(jq -r .state <<< "$item")" "$4" "state"
  expect "$name" "$(jq -r '.state_reason // ""' <<< "$item")" "$5" "state_reason"
  expect "$name" "$(jq -r '.closed // ""' <<< "$outputs")" "$6" "output closed"
  expect "$name" "$(jq -r '."matched-rule" // ""' <<< "$outputs")" "$7" "output matched-rule"
  expect "$name" "$(jq -r '."matched-labels" // ""' <<< "$outputs")" "$8" "output matched-labels"
  expect "$name" "$(jq -r '.number // ""' <<< "$outputs")" "$number" "output number"
}

# comments <case> <number> <expected comment bodies, newline separated>
comments() {
  local actual
  actual=$(gh api "repos/$GH_REPO/issues/$2/comments" --jq '.[].body')
  expect "$1" "$actual" "$3" "comments"
}

check or_hit "$N_OR_HIT" "$OUT_OR_HIT" closed not_planned true inline e2e-a
comments or_hit "$N_OR_HIT" 'e2e: rule inline matched `e2e-a`'

check and_miss "$N_AND_MISS" "$OUT_AND_MISS" open "" false "" ""

check and_hit "$N_AND_HIT" "$OUT_AND_HIT" closed completed true inline e2e-a,e2e-b
comments and_hit "$N_AND_HIT" ""

check not_blocked "$N_NOT_BLOCKED" "$OUT_NOT_BLOCKED" open "" false "" ""

check expr_hit "$N_EXPR_HIT" "$OUT_EXPR_HIT" closed not_planned true inline e2e-b
expect expr_hit "$(gh api "repos/$GH_REPO/issues/$N_EXPR_HIT" --jq .locked)" true "locked"

check file_rule "$N_FILE_RULE" "$OUT_FILE_RULE" closed completed true both e2e-a,e2e-b
comments file_rule "$N_FILE_RULE" 'e2e: file rule both matched `e2e-a`, `e2e-b`'

check dry_run "$N_DRY_RUN" "$OUT_DRY_RUN" open "" false inline e2e-a
comments dry_run "$N_DRY_RUN" ""

check wrong_target "$N_WRONG_TARGET" "$OUT_WRONG_TARGET" open "" false "" ""

check no_match "$N_NO_MATCH" "$OUT_NO_MATCH" open "" false "" ""

check pr "$N_PR" "$OUT_PR" closed "" true inline e2e-a
expect pr "$(gh api "repos/$GH_REPO/pulls/$N_PR" --jq '.state + "/" + (.merged | tostring)')" closed/false "pull request state/merged"

echo "Case bad_expr"
expect bad_expr "$BAD_EXPR_OUTCOME" failure "step outcome"

if ((failures > 0)); then
  echo "::error::$failures e2e assertion(s) failed"
  exit 1
fi
echo "All e2e assertions passed"
