const express = require('express');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');

function readPort(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({
          name,
          address: iface.address,
          score: scoreNetworkInterface(name, iface.address)
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].address : '127.0.0.1';
}

function scoreNetworkInterface(name, address) {
  const label = name.toLowerCase();
  let score = 0;

  if (isPrivateIPv4(address)) score += 20;
  if (label.includes('wi-fi') || label.includes('wifi') || label.includes('wireless')) score += 15;
  if (label.includes('ethernet') || label.includes('lan')) score += 10;
  if (address.startsWith('192.168.')) score += 8;
  if (address.startsWith('10.')) score += 6;
  if (address.startsWith('172.')) score += 4;
  if (label.includes('virtual') || label.includes('vmware') || label.includes('hyper-v') || label.includes('wsl')) score -= 20;
  if (label.includes('loopback') || label.includes('pseudo')) score -= 30;

  return score;
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}

function formatHostForUrl(host) {
  if (!host) return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function getRequestHost(req) {
  return req.hostname || req.ip || getLocalIP();
}

function getDashboardLanUrl() {
  return `http://${formatHostForUrl(getLocalIP())}:${DASHBOARD_PORT}`;
}

function getQrTargetUrl(req) {
  const requestedUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (requestedUrl.length > 0 && requestedUrl.length <= 300 && /^(https?|rtmp|rtsp|webrtc):\/\/[^\s]+$/i.test(requestedUrl)) {
    return requestedUrl;
  }
  return getDashboardLanUrl();
}

const DASHBOARD_PORT = readPort('DASHBOARD_PORT', 3000);
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';

// MediaMTX Ports
const RTMP_PORT = 1935;
const RTSP_PORT = 8554;
const HLS_PORT = 8888;
const WEBRTC_PORT = 8889;
const DEFAULT_STREAM_PATH = '/live/drone';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/server', async (req, res) => {
  const localIP = getLocalIP();
  const host = getRequestHost(req);

  res.json({
    status: 'running',
    uptime: process.uptime(),
    localIP,
    requestHost: host,
    rtmpPort: RTMP_PORT,
    rtspPort: RTSP_PORT,
    hlsPort: HLS_PORT,
    webrtcPort: WEBRTC_PORT,
    dashboardPort: DASHBOARD_PORT,
    urls: {
      dashboard: `http://${formatHostForUrl(host)}:${DASHBOARD_PORT}`,
      dashboardLan: `http://${formatHostForUrl(localIP)}:${DASHBOARD_PORT}`,
      rtmpBase: `rtmp://${formatHostForUrl(localIP)}:${RTMP_PORT}`,
      defaultPublish: `rtmp://${formatHostForUrl(localIP)}:${RTMP_PORT}${DEFAULT_STREAM_PATH}`
    }
  });
});

app.get('/api/streams', async (req, res) => {
  const host = getRequestHost(req);
  try {
    // Fetch paths from MediaMTX
    const response = await fetch(`${MEDIAMTX_API_URL}/v3/paths/list`);
    if (!response.ok) throw new Error('MediaMTX API error');
    
    const data = await response.json();
    const items = data.items || [];
    
    const streams = items
      .filter(item => item.ready)
      .map(item => {
        const streamPath = `/${item.name}`;
        const safeHost = formatHostForUrl(host);
        const nameParts = item.name.split('/').filter(Boolean);
        const appName = nameParts.length > 1 ? nameParts[0] : 'live';
        const streamKey = nameParts.length > 1 ? nameParts.slice(1).join('/') : item.name;
        
        return {
          id: item.name,
          app: appName,
          key: streamKey,
          streamPath,
          startTime: item.readyTime, // MediaMTX provides readyTime
          tracks: item.tracks || [],
          urls: {
            rtmp: `rtmp://${safeHost}:${RTMP_PORT}${streamPath}`,
            rtsp: `rtsp://${safeHost}:${RTSP_PORT}${streamPath}`,
            hls: `http://${safeHost}:${HLS_PORT}${streamPath}/index.m3u8`,
            hlsPage: `http://${safeHost}:${HLS_PORT}${streamPath}/`,
            webrtc: `http://${safeHost}:${WEBRTC_PORT}${streamPath}/`
          },
          source: item.sourceType || (item.source && item.source.type) || ''
        };
      });

    res.json({
      streams,
      count: streams.length
    });
  } catch (error) {
    console.error('Failed to fetch from MediaMTX:', error.message);
    res.json({
      streams: [],
      count: 0,
      error: 'MediaMTX not running or reachable'
    });
  }
});

app.get('/api/ip', (req, res) => {
  res.json({ ip: getLocalIP() });
});

app.get('/api/qr/dashboard.svg', async (req, res) => {
  try {
    const targetUrl = getQrTargetUrl(req);
    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 1,
      width: 220,
      color: {
        dark: '#0a0f1f',
        light: '#ffffff'
      }
    });

    res.set('Cache-Control', 'no-store');
    res.type('image/svg+xml').send(svg);
  } catch (error) {
    console.error('Failed to generate dashboard QR:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.post('/api/shutdown', (req, res) => {
  console.log('Shutdown requested from dashboard.');
  res.json({ ok: true, message: 'Server shutting down' });

  setTimeout(() => {
    if (dashboardServer) {
      dashboardServer.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
      return;
    }
    process.exit(0);
  }, 250);
});

const dashboardServer = app.listen(DASHBOARD_PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('DJI Drone RTMP Live Dashboard (MediaMTX Edition)');
  console.log('-------------------------------------');
  console.log(`Dashboard local:  http://localhost:${DASHBOARD_PORT}`);
  console.log(`Dashboard LAN:    http://${localIP}:${DASHBOARD_PORT}`);
  console.log('-------------------------------------');
  console.log('Pastikan MediaMTX sedang berjalan di port defaultnya:');
  console.log(`RTMP: ${RTMP_PORT}, RTSP: ${RTSP_PORT}, HLS: ${HLS_PORT}, WebRTC: ${WEBRTC_PORT}, API: 9997`);
  console.log('');
});
