# Termux Live Server

Folder ini berisi versi khusus Termux saja. Tidak ada `node_modules`, `.exe`, cache build, atau file Windows.

## Isi Folder

- `server.js` - dashboard Node.js
- `public/` - tampilan dashboard
- `mediamtx.yml` - config MediaMTX untuk RTMP/WebRTC/HLS/API
- `install.sh` - install dependency Termux
- `start.sh` - jalankan MediaMTX dan dashboard

## Cara Pakai di Termux

1. Copy folder `termux-live-server` ke HP.
2. Buka Termux, masuk ke folder ini.
3. Jalankan:

```bash
# Jika folder ada di Download Android:
# termux-setup-storage
# cd ~/storage/downloads/termux-live-server

chmod +x install.sh start.sh
./install.sh
./start.sh
```

## URL Drone

Masukkan ke DJI Custom RTMP:

```text
rtmp://IP_HP:1935/live/drone
```

Contoh:

```text
rtmp://192.168.8.171:1935/live/drone
```

Dashboard:

```text
http://IP_HP:3000
```

WebRTC langsung:

```text
http://IP_HP:8889/live/drone/
```

Dashboard kedua tanpa memutar video:

```text
http://IP_HP:3000?preview=off
```

## Catatan Penting

- Jalankan hanya satu MediaMTX.
- Kalau membuka lebih dari satu dashboard, pakai `?preview=off` untuk dashboard kedua agar tidak menambah viewer WebRTC.
- Kalau install MediaMTX gagal, taruh binary `mediamtx` yang cocok untuk Termux/Android di folder ini, lalu jalankan `./start.sh`.
- Jika ingin pakai binary di lokasi lain:

```bash
MEDIAMTX_BIN=/path/ke/mediamtx ./start.sh
```
