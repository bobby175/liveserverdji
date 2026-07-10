#!/data/data/com.termux/files/usr/bin/bash
set -eu

cd "$(dirname "$0")"

MEDIAMTX_PID=""

info() {
  printf '\033[1;36m[*]\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33m[!]\033[0m %s\n' "$1"
}

fail() {
  printf '\033[1;31m[ERROR]\033[0m %s\n' "$1"
  exit 1
}

cleanup() {
  if [ -n "$MEDIAMTX_PID" ]; then
    kill "$MEDIAMTX_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

find_mediamtx() {
  if [ -n "${MEDIAMTX_BIN:-}" ] && [ -x "$MEDIAMTX_BIN" ]; then
    printf '%s\n' "$MEDIAMTX_BIN"
    return 0
  fi

  if [ -x "./mediamtx" ]; then
    printf '%s\n' "./mediamtx"
    return 0
  fi

  if command -v mediamtx >/dev/null 2>&1; then
    command -v mediamtx
    return 0
  fi

  return 1
}

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js belum ada. Jalankan: ./install.sh"
fi

if [ ! -d "./node_modules" ]; then
  warn "node_modules belum ada. Menjalankan install.sh dulu."
  ./install.sh || exit 1
fi

MEDIAMTX_PATH="$(find_mediamtx)" || fail "MediaMTX belum ada. Jalankan: ./install.sh"

mkdir -p logs

export DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
export MEDIAMTX_API_URL="${MEDIAMTX_API_URL:-http://127.0.0.1:9997}"

info "Menjalankan MediaMTX: $MEDIAMTX_PATH"
"$MEDIAMTX_PATH" mediamtx.yml > logs/mediamtx.log 2>&1 &
MEDIAMTX_PID=$!

sleep 2

if ! kill -0 "$MEDIAMTX_PID" >/dev/null 2>&1; then
  warn "MediaMTX gagal start. Log terakhir:"
  tail -n 30 logs/mediamtx.log || true
  fail "Pastikan tidak ada MediaMTX lain yang masih berjalan."
fi

info "Menjalankan dashboard Node.js"
info "DJI RTMP: rtmp://IP_HP:1935/live/drone"
info "Dashboard: http://IP_HP:${DASHBOARD_PORT}"
info "Dashboard kedua tanpa preview: http://IP_HP:${DASHBOARD_PORT}?preview=off"
node server.js
