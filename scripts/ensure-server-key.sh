#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <project-id> [secret-id]" >&2
  exit 2
fi

project_id="$1"
secret_id="${2:-ptcgl-wireguard-server-key}"
command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 1; }
command -v wg >/dev/null || { echo "wg is required" >&2; exit 1; }

existing_versions="$(gcloud secrets versions list "$secret_id" --project "$project_id" --format='value(name)')"
if [ -n "$existing_versions" ]; then
  echo "A server key version already exists; refusing to create or rotate it."
  exit 0
fi
unset existing_versions

private_key="$(wg genkey)"
printf '%s' "$private_key" | gcloud secrets versions add "$secret_id" --project "$project_id" --data-file=- >/dev/null
unset private_key
echo "Created the initial server key version."
