# DJI RTMP Live Server

Dashboard lokal untuk menerima live stream RTMP dari DJI/OBS dan menampilkannya di browser dengan HTTP-FLV low latency.

## Fitur

- RTMP ingest di port `1935`
- Dashboard web di port `3000`
- HTTP-FLV preview di port `8000`
- Auto-detect stream aktif
- URL DJI/OBS otomatis mengikuti IP server
- HLS otomatis memakai `ffmpeg-static`

## Install

```bash
npm install
```

## Jalankan

```bash
npm start
```

Setelah server berjalan, buka:

```text
http://localhost:3000
```

Jika ingin dibuka dari perangkat lain dalam jaringan yang sama, gunakan URL LAN yang muncul di terminal, misalnya:

```text
http://192.168.x.x:3000
```

Dashboard juga menampilkan URL LAN yang bisa disalin dari panel setup.

Jika perangkat lain tidak bisa membuka dashboard:

- Pastikan semua perangkat berada di WiFi/hotspot yang sama
- Pastikan firewall mengizinkan port `3000`, `1935`, dan `8000`
- Gunakan IP LAN server, bukan `localhost`

## Fullscreen

Klik tombol fullscreen di pojok kanan atas player untuk membuka tampilan live memenuhi layar. Tombol tetap tersedia saat player berada dalam mode fullscreen.

## URL untuk DJI

Masukkan URL berikut di DJI Custom RTMP, sesuaikan IP dengan yang muncul di dashboard/terminal:

```text
rtmp://<IP-SERVER>:1935/live/drone
```

Contoh:

```text
rtmp://192.168.8.171:1935/live/drone
```

## Test Publish dari OBS

Di OBS:

- Service: `Custom`
- Server: `rtmp://<IP-SERVER>:1935/live`
- Stream Key: `drone`

Lalu klik `Start Streaming`.

## Low Latency

Untuk delay rendah, gunakan jalur HTTP-FLV di dashboard. Hindari HLS untuk preview realtime.

Setting sumber stream yang disarankan:

- Codec: H.264
- FPS: 30
- Keyframe interval: 1-2 detik
- Bitrate 720p: 2-4 Mbps
- Bitrate 1080p: 4-8 Mbps
- Gunakan WiFi 5 GHz atau LAN jika memungkinkan

## HLS / FFmpeg

Project ini memakai `ffmpeg-static`, jadi HLS akan aktif otomatis setelah:

```bash
npm install
```

Jika ingin memakai FFmpeg dari sistem, set `FFMPEG_PATH` sebelum menjalankan server.

Windows PowerShell:

```powershell
$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"
npm start
```

Linux/Termux:

```bash
FFMPEG_PATH=/usr/bin/ffmpeg npm start
```

Untuk preview delay rendah tetap gunakan HTTP-FLV. HLS lebih cocok sebagai fallback untuk player yang tidak mendukung FLV.

## Android / Termux

Project ini juga bisa dijalankan di Android dengan Termux:

```bash
pkg update
pkg install nodejs git
git clone https://github.com/bobby175/liveserverdji.git
cd liveserverdji
npm install
npm start
```

Jika DJI app dan server berjalan di HP yang sama, coba URL:

```text
rtmp://127.0.0.1:1935/live/drone
```

Jika tidak bisa, pakai IP HP di jaringan/hotspot.
