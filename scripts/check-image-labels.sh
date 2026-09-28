#!/usr/bin/env bash
# Inspect one GHCR tag and verify its OCI labels before a publish or reuse.
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

: "${IMAGE:?IMAGE is required}"
: "${TAG:?TAG is required}"
: "${EXPECTED_SOURCE:?EXPECTED_SOURCE is required}"
: "${EXPECTED_REVISION:?EXPECTED_REVISION is required}"
: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"

strict_inspect="${STRICT_INSPECT:-false}"
require_version="${REQUIRE_VERSION:-false}"
inspect_file="$(mktemp)"
trap 'rm -f "$inspect_file"' EXIT

if docker buildx imagetools inspect "$IMAGE:$TAG" --format '{{json .Image}}' >"$inspect_file" 2>&1; then
  if jq -e \
    --arg revision "$EXPECTED_REVISION" \
    --arg source "$EXPECTED_SOURCE" \
    --arg version "$EXPECTED_VERSION" \
    --arg require_version "$require_version" '
      def configs:
        if (.config? | type) == "object" then [.config]
        else [to_entries[] | .value.config? | select(type == "object")]
        end;
      configs
      | if length == 0 then false
        else all(.[];
          ((.Labels? // {}) | .["org.opencontainers.image.revision"]) == $revision
          and ((.Labels? // {}) | .["org.opencontainers.image.source"]) == $source
          and ($require_version != "true"
            or ((.Labels? // {}) | .["org.opencontainers.image.version"]) == $version))
        end
    ' "$inspect_file" >/dev/null; then
    emit exists true
    printf 'image tag exists with expected OCI labels: %s:%s\n' "$IMAGE" "$TAG"
    exit 0
  fi

  cat "$inspect_file" >&2
  fail "existing image tag has unexpected OCI labels: $IMAGE:$TAG"
fi

if grep -Eiq 'manifest unknown|name unknown|no such manifest|not found|404' "$inspect_file"; then
  emit exists false
  printf 'image tag does not exist: %s:%s\n' "$IMAGE" "$TAG"
  exit 0
fi

if [[ "$strict_inspect" == true ]]; then
  cat "$inspect_file" >&2
  fail "could not determine whether image tag exists: $IMAGE:$TAG"
fi

echo "::notice title=Image tag inspect failed::Inspecting $IMAGE:$TAG failed; build/push will be attempted."
cat "$inspect_file" >&2
emit exists false
