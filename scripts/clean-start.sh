#!/usr/bin/env bash
# `make clean-start`: prove that a fresh copy of the repository boots and verifies.
#
# Copies every file Git tracks, plus untracked files that are not ignored (what
# the next commit would hold), into a temporary directory, with an empty data
# directory and its own port, then runs setup, infra-up, migrate and verify,
# starts `make dev`, runs `make smoke` against it, and tears everything down.
# Nothing outside the two temporary directories is touched, except the npm and
# Playwright download caches.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/emberglass-clean-start-XXXXXX")"
data="$(mktemp -d "${TMPDIR:-/tmp}/emberglass-clean-data-XXXXXX")"
port="${CLEAN_START_PORT:-3207}"
dev_pid=""

teardown() {
  status=$?
  if [ -n "$dev_pid" ] && kill -0 "$dev_pid" 2>/dev/null; then
    # `make dev` runs in its own process group; stop all of it.
    kill -TERM -- "-$dev_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$dev_pid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$dev_pid" 2>/dev/null || true
  fi
  (cd "$work" 2>/dev/null && make infra-down) || true
  rm -rf "$work" "$data"
  if [ "$status" -eq 0 ]; then echo "clean-start: passed; $work and $data removed."; else echo "clean-start: FAILED (exit $status); $work and $data removed." >&2; fi
  exit "$status"
}
trap teardown EXIT

echo "clean-start: copying the repository into $work"
(cd "$repo" && git ls-files -z --cached --others --exclude-standard \
  | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done \
  | tar --null -T - -cf -) | tar -xf - -C "$work"

cd "$work"
git init -q && git add -A   # scan-secrets and the doc gate read the file list from Git

# Written before `make setup`, which then keeps it: this run's data directory and port.
printf 'EMBERGLASS_DATA_DIR=%s\nEMBERGLASS_PORT=%s\n' "$data" "$port" > .env
unset EMBERGLASS_DATA_DIR EMBERGLASS_PORT

[ -z "$(ls -A "$data")" ] || { echo "clean-start: $data is not empty" >&2; exit 1; }

make setup
make infra-up
make migrate
make verify

echo "clean-start: starting make dev on port $port"
setsid make dev > "$work/dev.log" 2>&1 &
dev_pid=$!
if ! make smoke SMOKE_WAIT=90; then
  echo "clean-start: make dev output:" >&2
  cat "$work/dev.log" >&2
  exit 1
fi
