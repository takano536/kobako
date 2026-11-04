#!/usr/bin/env bash
# Materialize a clean baseline checkout in the persistent user cache.
set -euo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 || -z "$1" ]]; then
  fail "usage: $0 <ref>"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if ! repo_root="$(git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null)"; then
  fail "could not locate the git repository"
fi
repo_root="$(cd -- "$repo_root" && pwd -P)"

ref="$1"
if ! resolved_ref="$(git -C "$repo_root" rev-parse --verify --end-of-options "${ref}^{commit}" 2>/dev/null)"; then
  fail "ref does not resolve to a commit: $ref"
fi

cache_home="${XDG_CACHE_HOME:-${HOME:?HOME is required}/.cache}"
[[ "$cache_home" = /* ]] || fail "XDG_CACHE_HOME must be an absolute path"
cache_root="$cache_home/kobako"
mkdir -p -- "$cache_root"
cache_root="$(cd -- "$cache_root" && pwd -P)"

case "$cache_root" in
  /tmp|/tmp/*|/dev/shm|/dev/shm/*)
    fail "cache directory must not be under /tmp or /dev/shm: $cache_root"
    ;;
esac
case "$cache_root/" in
  "$repo_root/"*)
    fail "cache directory must not be inside the repository: $cache_root"
    ;;
esac

destination="$cache_root/$resolved_ref"
marker="$destination/.kobako-baseline-complete"
if [[ -f "$marker" ]]; then
  if [[ "$(<"$marker")" != "$resolved_ref" ]]; then
    fail "completion marker does not match the resolved ref: $destination"
  fi
  printf '%s\n' "$destination"
  exit 0
fi
if [[ -e "$destination" ]]; then
  fail "incomplete baseline cache already exists: $destination"
fi

tmp_dir="$(mktemp -d "$cache_root/.${resolved_ref}.tmp.XXXXXX")"
cleanup() {
  if [[ -n "${tmp_dir:-}" ]]; then
    rm -rf -- "$tmp_dir"
  fi
}
trap cleanup EXIT

printf 'creating baseline checkout for %s at %s\n' "$resolved_ref" "$destination" >&2
if ! git -C "$repo_root" archive --format=tar "$resolved_ref" | tar -x -C "$tmp_dir"; then
  fail "could not archive ref: $ref"
fi

printf '%s\n' "$resolved_ref" >"$tmp_dir/.kobako-baseline-complete"
if [[ -e "$destination" ]]; then
  fail "baseline cache appeared while creating it: $destination"
fi
mv -- "$tmp_dir" "$destination"
tmp_dir=''
printf '%s\n' "$destination"
