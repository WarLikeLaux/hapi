#!/usr/bin/env bash
# Prepares a released slot (arg $1) for the next task: re-sync dependencies
# with the merged main branch and drop build artifacts from the previous task.
set -Eeuo pipefail
cd -- "$1"
bun install --frozen-lockfile
rm -rf web/dist hub/dist cli/dist-exe
