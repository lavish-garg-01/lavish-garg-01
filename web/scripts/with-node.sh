#!/usr/bin/env bash
set -eo pipefail

# Read the shared pin so project commands cannot drift from .nvmrc.
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required_version="$(tr -d '[:space:]' < "$project_dir/.nvmrc")"
required_version="${required_version#v}"
nvm_root="${NVM_DIR:-$HOME/.nvm}"
pinned_bin="$nvm_root/versions/node/v$required_version/bin"

if [[ "$(node --version 2>/dev/null || true)" != "v$required_version" ]]; then
  if [[ -x "$pinned_bin/node" ]]; then
    export PATH="$pinned_bin:$PATH"
  elif [[ -s "$nvm_root/nvm.sh" ]]; then
    export NVM_DIR="$nvm_root"
    source "$nvm_root/nvm.sh" --no-use
    nvm install "$required_version"
    nvm use --silent "$required_version"
  else
    printf 'Node %s is required. Install nvm or put that Node version on PATH.\n' "$required_version" >&2
    exit 1
  fi
fi

if [[ "$(node --version)" != "v$required_version" ]]; then
  printf 'Unable to activate Node %s.\n' "$required_version" >&2
  exit 1
fi

printf 'Using Node %s\n' "$(node --version)"
exec "$@"
