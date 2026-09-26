#!/usr/bin/env bash
# Installs dependencies in a slot worktree (arg $1) using the shared bun cache.
set -Eeuo pipefail
cd -- "$1"
bun install --frozen-lockfile
