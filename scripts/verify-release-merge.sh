#!/usr/bin/env bash
# Verify a merged Release Please PR before allowing the action to tag it.
set -euo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

emit() {
  local key="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
  fi
}

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

pending_label="${PENDING_RELEASE_LABEL:-autorelease: pending}"
required_checks=(lint unit integration build e2e docker)

pending_prs="$(gh pr list \
  --repo "$GITHUB_REPOSITORY" \
  --state merged \
  --base main \
  --label "$pending_label" \
  --limit 100 \
  --json number,mergeCommit,mergedAt,headRefName,baseRefName)"

candidates="$(jq -c --arg prefix 'release-please--branches--main' '
  map(select(.baseRefName == "main"
    and (.mergeCommit.oid // "") != ""
    and (.headRefName | startswith($prefix))))
  | sort_by(.mergedAt)
' <<<"$pending_prs")"
candidate_count="$(jq 'length' <<<"$candidates")"

if [[ "$candidate_count" == 0 ]]; then
  emit pending_release false
  emit validated true
  echo 'No merged pending Release Please PR; this is a regular main push.'
  exit 0
fi

if [[ "$candidate_count" != 1 ]]; then
  fail "expected at most one merged pending Release Please PR, found $candidate_count"
fi

pending_pr="$(jq -c '.[0]' <<<"$candidates")"
pr_number="$(jq -r '.number' <<<"$pending_pr")"
merge_sha="$(jq -r '.mergeCommit.oid' <<<"$pending_pr")"
head_ref="$(jq -r '.headRefName' <<<"$pending_pr")"

if [[ ! "$merge_sha" =~ ^[0-9a-f]{40}$ ]]; then
  fail "merged Release PR #$pr_number returned an invalid merge commit SHA: $merge_sha"
fi

if ! git merge-base --is-ancestor "$merge_sha" "$GITHUB_SHA"; then
  fail "merged Release PR #$pr_number commit $merge_sha is not an ancestor of current main commit $GITHUB_SHA"
fi

check_runs="$(gh api \
  "repos/$GITHUB_REPOSITORY/commits/$merge_sha/check-runs?per_page=100" \
  --jq '.check_runs')"

for check_name in "${required_checks[@]}"; do
  latest="$(jq -r --arg name "$check_name" '
    [.[] | select(.name == $name)]
    | sort_by((.completed_at // .started_at // ""))
    | last
    | if . == null then "" else [.status, .conclusion] | @tsv end
  ' <<<"$check_runs")"
  if [[ "$latest" != $'completed\tsuccess' ]]; then
    fail "required check $check_name on merged Release PR #$pr_number ($merge_sha) is not completed successfully: ${latest:-missing}"
  fi
done

echo "Merged Release PR #$pr_number ($head_ref) passed all required checks at $merge_sha"
emit pending_release true
emit validated true
emit release_pr_number "$pr_number"
emit release_merge_sha "$merge_sha"
