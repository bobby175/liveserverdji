#!/data/data/com.termux/files/usr/bin/bash
set -eu

cd "$(dirname "$0")"

MEDIAMTX_VERSION="${MEDIAMTX_VERSION:-v1.16.3}"

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

if ! command -v pkg >/dev/null 2>&1; then
  fail "Script ini harus dijalankan di Termux."
fi

info "Update package Termux"
pkg update -y

info "Install Node.js dan tool dasar"
pkg install -y nodejs git

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js belum tersedia setelah install."
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "npm belum tersedia. Coba jalankan ulang: pkg install nodejs"
fi

info "Install dependency dashboard"
npm install --omit=dev --no-audit --no-fund --no-bin-links

if [ -x "./mediamtx" ] || command -v mediamtx >/dev/null 2>&1; then
  info "MediaMTX sudah tersedia"
  exit 0
fi

info "Mencoba install MediaMTX dari repo Termux"
if pkg install -y mediamtx; then
  info "MediaMTX berhasil diinstall dari repo Termux"
  exit 0
fi

warn "Package mediamtx tidak tersedia di repo Termux perangkat ini."
warn "Fallback: compile MediaMTX dari source memakai Go. Ini bisa agak lama."
pkg install -y golang

mkdir -p .bin
if GOBIN="$PWD/.bin" go install "github.com/bluenviron/mediamtx@$MEDIAMTX_VERSION"; then
  cp ".bin/mediamtx" "./mediamtx"
  chmod +x "./mediamtx"
  info "MediaMTX berhasil dibuat: ./mediamtx"
  exit 0
fi

fail "MediaMTX gagal dipasang. Taruh binary mediamtx Termux/Android di folder ini, atau set MEDIAMTX_BIN=/path/mediamtx saat menjalankan start.sh."
