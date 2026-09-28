#!/usr/bin/env bash
# Compute the image tags for each CI event without talking to a registry.
# Inputs are the environment values used by the CI workflow:
# GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_SHA, RELEASE_CREATED, and RELEASE_TAG.
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
  printf '%s=%s\n' "$key" "$value"
}

# Keep this expression deliberately strict: release images are only published
# for plain SemVer tags created by Release Please, with no leading zeroes,
# prerelease suffixes, or build metadata.
semver_tag_re='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

: "${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

release_tag="${RELEASE_TAG:-}"
release_created="${RELEASE_CREATED:-true}"
if [[ -n "$release_tag" ]]; then
  [[ "$release_created" == true ]] || fail "release tag was supplied without release_created=true"
  [[ "$release_tag" =~ $semver_tag_re ]] || fail "release tag must match ^vX.Y.Z$: $release_tag"
  version="${release_tag#v}"
  [[ "$version" != 0.1.0 ]] || fail "v0.1.0 is retired and must not be published"
  emit mode release
  emit push true
  emit version "$version"
  emit web_tag "$version"
  emit migrate_tag "$version"
  emit sha_tag "sha-${GITHUB_SHA}"
  emit promote_latest true
  emit release_tag "$release_tag"
  exit 0
fi

case "$GITHUB_EVENT_NAME" in
  pull_request)
    emit mode none
    emit push false
    emit version none
    emit web_tag none
    emit migrate_tag none
    emit promote_latest false
    ;;
  push)
    if [[ "${GITHUB_REF:-}" != refs/heads/main ]]; then
      emit mode none
      emit push false
      emit version none
      emit web_tag none
      emit migrate_tag none
      emit promote_latest false
      exit 0
    fi
    sha_tag="sha-${GITHUB_SHA}"
    emit mode main
    emit push true
    emit version "$sha_tag"
    emit web_tag "$sha_tag"
    emit migrate_tag "$sha_tag"
    emit promote_latest true
    emit sha_tag "$sha_tag"
    ;;
  *)
    fail "unsupported CI event: $GITHUB_EVENT_NAME"
    ;;
esac
