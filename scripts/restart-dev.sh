#!/usr/bin/env bash
#
# restart-dev.sh — Gracefully restart all OpenLobby dev services
#
# Usage:
#   ./scripts/restart-dev.sh          # restart all dev services
#   ./scripts/restart-dev.sh server   # restart only @openlobby/server
#   ./scripts/restart-dev.sh web      # restart only @openlobby/web
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT_DIR/.dev.pid"
LOGFILE="$ROOT_DIR/.dev.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[restart-dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[restart-dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[restart-dev]${NC} $*"; }
err()  { echo -e "${RED}[restart-dev]${NC} $*" >&2; }

# ── Stop running dev processes ──────────────────────────────────────
stop_dev() {
  log "Stopping dev services..."

  # 1. Try pidfile first
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid=$(<"$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      # Wait up to 5s for graceful shutdown
      for i in {1..10}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      # Force kill if still alive
      if kill -0 "$pid" 2>/dev/null; then
        warn "Force killing PID $pid"
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PIDFILE"
  fi

  # 2. Kill any remaining dev processes spawned from this project
  local pids
  pids=$(pgrep -f "tsx watch.*openlobby" 2>/dev/null || true)
  pids+=" $(pgrep -f "vite.*openlobby" 2>/dev/null || true)"
  pids+=" $(pgrep -f "tsc --watch.*openlobby" 2>/dev/null || true)"
  pids+=" $(pgrep -f "pnpm.*-r.*--parallel.*dev" 2>/dev/null || true)"

  for pid in $pids; do
    [[ -z "$pid" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then
      log "  Killing leftover process $pid"
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  sleep 1
  ok "Dev services stopped."
}

# ── Start dev services ──────────────────────────────────────────────
start_dev() {
  local filter="${1:-}"

  cd "$ROOT_DIR"

  if [[ -n "$filter" ]]; then
    local pkg="@openlobby/$filter"
    log "Starting dev for $pkg ..."
    nohup pnpm --filter "$pkg" dev > "$LOGFILE" 2>&1 &
  else
    log "Starting all dev services..."
    nohup pnpm -r --parallel dev > "$LOGFILE" 2>&1 &
  fi

  local pid=$!
  echo "$pid" > "$PIDFILE"

  # Wait a moment and verify it started
  sleep 2
  if kill -0 "$pid" 2>/dev/null; then
    ok "Dev services started (PID: $pid)"
    ok "Logs: tail -f $LOGFILE"
  else
    err "Failed to start! Check logs:"
    tail -20 "$LOGFILE"
    exit 1
  fi
}

# ── Main ────────────────────────────────────────────────────────────
main() {
  local filter="${1:-}"

  # Validate filter
  if [[ -n "$filter" ]]; then
    local valid_filters=("core" "server" "web" "cli" "channel-telegram")
    local found=false
    for v in "${valid_filters[@]}"; do
      [[ "$filter" == "$v" ]] && found=true && break
    done
    if [[ "$found" == false ]]; then
      err "Unknown package: $filter"
      err "Valid packages: ${valid_filters[*]}"
      exit 1
    fi
  fi

  stop_dev
  start_dev "$filter"
}

main "$@"
