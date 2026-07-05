const NodeMediaServer = require('node-media-server');
const express = require('express');
const path = require('path');
const os = require('os');

/* ─── IP Detection ─── */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal (loopback) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

/* ─── Configuration ─── */
const RTMP_PORT = 1935;
const HTTP_FLV_PORT = 8000;
const DASHBOARD_PORT = 3000;

/* ─── Active Streams Store ─── */
const activeStreams = new Map();

/* ─── Node Media Server Config ─── */
const nmsConfig = {
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: false,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: HTTP_FLV_PORT,
    mediaroot: './media',
    allow_origin: '*'
  },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        hlsKeep: false
      }
    ]
  },
  auth: {
    play: false,
    publish: false
  }
};

const nms = new NodeMediaServer(nmsConfig);

/* ─── Stream Event Listeners ─── */
nms.on('preConnect', (id, args) => {
  console.log('[NodeEvent on preConnect]', `id=${id}`, JSON.stringify(args));
});

nms.on('postConnect', (id, args) => {
  console.log('[NodeEvent on postConnect]', `id=${id}`);
});

nms.on('doneConnect', (id, args) => {
  console.log('[NodeEvent on doneConnect]', `id=${id}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath}`);

  const parts = StreamPath.split('/');
  const app = parts[1];
  const key = parts[2];

  activeStreams.set(StreamPath, {
    id,
    app,
    key,
    streamPath: StreamPath,
    startTime: new Date().toISOString(),
    clientInfo: args || {}
  });

  console.log(`\n🟢 Stream STARTED: ${StreamPath}`);
  console.log(`   ├── RTMP URL:     rtmp://localhost:${RTMP_PORT}${StreamPath}`);
  console.log(`   ├── HTTP-FLV:     http://localhost:${HTTP_FLV_PORT}${StreamPath}.flv`);
  console.log(`   ├── HLS:          http://localhost:${HTTP_FLV_PORT}${StreamPath}/index.m3u8`);
  console.log(`   └── Dashboard:    http://localhost:${DASHBOARD_PORT}\n`);
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log(`\n🔴 Stream ENDED: ${StreamPath}\n`);
  activeStreams.delete(StreamPath);
});

nms.on('prePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath}`);
});

nms.on('donePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath}`);
});

/* ─── Express Dashboard Server ─── */
const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Get active streams
app.get('/api/streams', (req, res) => {
  const streams = [];
  activeStreams.forEach((stream, path) => {
    streams.push({
      ...stream,
      urls: {
        rtmp: `rtmp://localhost:${RTMP_PORT}${path}`,
        httpFlv: `http://localhost:${HTTP_FLV_PORT}${path}.flv`,
        hls: `http://localhost:${HTTP_FLV_PORT}${path}/index.m3u8`,
        wsFlv: `ws://localhost:${HTTP_FLV_PORT}${path}.flv`
      }
    });
  });
  res.json({ streams, count: streams.length });
});

// API: Get server info
app.get('/api/server', (req, res) => {
  const localIP = getLocalIP();
  res.json({
    status: 'running',
    uptime: process.uptime(),
    localIP,
    rtmpPort: RTMP_PORT,
    httpFlvPort: HTTP_FLV_PORT,
    dashboardPort: DASHBOARD_PORT,
    activeStreams: activeStreams.size,
    memory: process.memoryUsage()
  });
});

// API: Get local IP
app.get('/api/ip', (req, res) => {
  res.json({ ip: getLocalIP() });
});

// API: Get connection config for OBS
app.get('/api/obs-config', (req, res) => {
  const streams = [];
  activeStreams.forEach((stream, path) => {
    streams.push({
      name: stream.key,
      rtmpUrl: `rtmp://localhost:${RTMP_PORT}/${stream.app}`,
      streamKey: stream.key,
      httpFlvUrl: `http://localhost:${HTTP_FLV_PORT}${path}.flv`,
      hlsUrl: `http://localhost:${HTTP_FLV_PORT}${path}/index.m3u8`
    });
  });
  res.json({
    server: {
      rtmpBase: `rtmp://localhost:${RTMP_PORT}/live`,
      httpFlvBase: `http://localhost:${HTTP_FLV_PORT}/live`
    },
    activeStreams: streams
  });
});

/* ─── Start Everything ─── */
nms.run();

app.listen(DASHBOARD_PORT, () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     🚁 DJI DRONE RTMP LIVE STREAMING SERVER 🚁     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  📡 RTMP Server:     rtmp://localhost:${RTMP_PORT}/live/<key>  ║`);
  console.log(`║  🎞️  HTTP-FLV:        http://localhost:${HTTP_FLV_PORT}/live/<key>.flv ║`);
  console.log(`║  🌐 Dashboard:       http://localhost:${DASHBOARD_PORT}               ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║                                                      ║');
  console.log('║  DJI App RTMP URL:                                   ║');
  console.log(`║  rtmp://<YOUR-IP>:${RTMP_PORT}/live/drone                      ║`);
  console.log('║                                                      ║');
  console.log('║  OBS Studio Media Source:                             ║');
  console.log(`║  rtmp://localhost:${RTMP_PORT}/live/drone                      ║`);
  console.log('║                                                      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
});
