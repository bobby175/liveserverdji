# DJI RTMP Live Server (MediaMTX Edition)

Dashboard lokal untuk menerima live stream RTMP dari DJI/OBS dan menampilkannya di browser dengan WebRTC (Ultra Low Latency). Backend streaming kini menggunakan **MediaMTX** yang jauh lebih cepat, ringan, dan mendukung berbagai protokol (RTMP, RTSP, HLS, WebRTC).

## Fitur

- Menggunakan **MediaMTX** sebagai engine streaming utama.
- Dashboard web di port `3000`
- WebRTC preview di port `8889` (Latensi sangat rendah < 0.5 detik di browser)
- RTSP `8554` & HLS `8888` fallback
- URL DJI/OBS otomatis mengikuti IP server
- QR code dashboard LAN untuk ditonton dari HP lain
- Mendukung penuh Termux (Android) dan PC (Windows/Linux/Mac).

## Instalasi & Menjalankan (Windows / PC)

1. **Jalankan MediaMTX**:
   - Download MediaMTX dari [Releases GitHub](https://github.com/bluenviron/mediamtx/releases).
   - Ekstrak dan jalankan `mediamtx.exe` (Pastikan menggunakan file `mediamtx.yml` yang mengaktifkan API di port `9997`).
2. **Jalankan Dashboard**:
   - Buka terminal di folder project ini.
   - Install dependensi: `npm install`
   - Jalankan server: `npm start`
3. Buka browser: `http://localhost:3000`

## Menjalankan di Android (Termux)

MediaMTX dan Dashboard ini dapat dijalankan sepenuhnya di HP Android Anda melalui Termux!

1. Buka Termux, jalankan update dan install package:
   ```bash
   pkg update
   pkg install nodejs git wget
   ```
2. Download MediaMTX (Contoh untuk ARM64):
   ```bash
   wget https://github.com/bluenviron/mediamtx/releases/download/v1.9.0/mediamtx_v1.9.0_linux_arm64.tar.gz
   tar -xvzf mediamtx_v1.9.0_linux_arm64.tar.gz
   ```
3. Edit `mediamtx.yml` (Bisa pakai `nano mediamtx.yml`), pastikan API aktif:
   ```yaml
   api: yes
   apiAddress: :9997
   ```
4. Jalankan MediaMTX di background (atau di session Termux baru):
   ```bash
   ./mediamtx &
   ```
5. Clone dan jalankan Dashboard:
   ```bash
   git clone https://github.com/bobby175/liveserverdji.git
   cd liveserverdji
   npm install
   npm start
   ```
6. Buka IP Android Anda di browser (Port 3000). Contoh: `http://192.168.1.5:3000`

## URL untuk DJI

Masukkan URL berikut di DJI Custom RTMP, sesuaikan IP dengan yang muncul di dashboard/terminal:

```text
rtmp://<IP-SERVER>:1935/live/drone
```

## Test Publish dari OBS

Di OBS:

- Service: `Custom`
- Server: `rtmp://<IP-SERVER>:1935/live`
- Stream Key: `drone`

## Ekspor ke OBS / vMix / Software Lain

Dashboard ini menyediakan beberapa output yang bisa ditangkap oleh software produksi:

1. **WebRTC**: Latensi super rendah untuk Browser Source.
2. **RTSP**: Paling stabil untuk VLC / OBS Media Source.
3. **RTMP**: Standar penyiaran.
4. **HLS**: Paling kompatibel (namun delay tinggi).
