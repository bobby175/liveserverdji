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

detect_lan_ip() {
  local detected=""

  if [ -n "${WEBRTC_HOST:-}" ]; then
    printf '%s\n' "$WEBRTC_HOST"
    return 0
  fi

  if command -v ip >/dev/null 2>&1; then
    detected="$(ip -o -4 addr show scope global 2>/dev/null | awk '{ split($4, item, "/"); print item[1]; exit }' || true)"
    if [ -n "$detected" ]; then
      printf '%s\n' "$detected"
      return 0
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    detected="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2; exit }' || true)"
    if [ -n "$detected" ]; then
      printf '%s\n' "$detected"
      return 0
    fi
  fi

  hostname -I 2>/dev/null | awk '{ print $1 }' || true
}

write_runtime_config() {
  local host="$1"
  local output="logs/mediamtx.termux.yml"

  awk -v host="$host" '
    /^webrtcAdditionalHosts:/ {
      print "webrtcAdditionalHosts: [" host "]"
      next
    }
    { print }
  ' mediamtx.yml > "$output"

  printf '%s\n' "$output"
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

LAN_IP="$(detect_lan_ip)"
if [ -z "$LAN_IP" ]; then
  fail "IP HP tidak terdeteksi. Jalankan manual: WEBRTC_HOST=IP_HP ./start.sh"
fi

MEDIAMTX_CONFIG="$(write_runtime_config "$LAN_IP")"

info "Menjalankan MediaMTX: $MEDIAMTX_PATH"
info "WebRTC host: $LAN_IP"
"$MEDIAMTX_PATH" "$MEDIAMTX_CONFIG" > logs/mediamtx.log 2>&1 &
MEDIAMTX_PID=$!

sleep 2

if ! kill -0 "$MEDIAMTX_PID" >/dev/null 2>&1; then
  warn "MediaMTX gagal start. Log terakhir:"
  tail -n 30 logs/mediamtx.log || true
  fail "Pastikan tidak ada MediaMTX lain yang masih berjalan."
fi

info "Menjalankan dashboard Node.js"
info "DJI RTMP: rtmp://${LAN_IP}:1935/live/drone"
info "Dashboard: http://${LAN_IP}:${DASHBOARD_PORT}"
info "Dashboard kedua tanpa preview: http://${LAN_IP}:${DASHBOARD_PORT}?preview=off"
node server.js
