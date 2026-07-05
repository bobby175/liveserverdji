const NodeMediaServer = require('node-media-server');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function readPort(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

function hasExecutable(command) {
  const result = spawnSync(command, ['-version'], {
    stdio: 'ignore',
    windowsHide: true
  });

  return !result.error && result.status === 0;
}

function formatHostForUrl(host) {
  if (!host) return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function getRequestHost(req) {
  return req.hostname || req.ip || getLocalIP();
}

function parseStreamPath(streamPath) {
  const match = /^\/([^/]+)\/(.+)$/.exec(streamPath || '');
  if (!match) {
    return { app: 'live', key: 'drone' };
  }

  return {
    app: match[1],
    key: match[2]
  };
}

const RTMP_PORT = readPort('RTMP_PORT', 1935);
const HTTP_FLV_PORT = readPort('HTTP_FLV_PORT', 8000);
const DASHBOARD_PORT = readPort('DASHBOARD_PORT', 3000);
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, 'media');
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const HLS_ENABLED = process.env.HLS_ENABLED !== 'false' && hasExecutable(FFMPEG_PATH);

fs.mkdirSync(MEDIA_ROOT, { recursive: true });

const activeStreams = new Map();

function buildStreamUrls(streamPath, host, includeLocalhost = false) {
  const safeHost = formatHostForUrl(host);
  const urls = {
    rtmp: `rtmp://${safeHost}:${RTMP_PORT}${streamPath}`,
    httpFlv: `http://${safeHost}:${HTTP_FLV_PORT}${streamPath}.flv`,
    wsFlv: `ws://${safeHost}:${HTTP_FLV_PORT}${streamPath}.flv`,
    hls: HLS_ENABLED ? `http://${safeHost}:${HTTP_FLV_PORT}${streamPath}/index.m3u8` : null
  };

  if (includeLocalhost) {
    urls.local = {
      rtmp: `rtmp://localhost:${RTMP_PORT}${streamPath}`,
      httpFlv: `http://localhost:${HTTP_FLV_PORT}${streamPath}.flv`,
      wsFlv: `ws://localhost:${HTTP_FLV_PORT}${streamPath}.flv`,
      hls: HLS_ENABLED ? `http://localhost:${HTTP_FLV_PORT}${streamPath}/index.m3u8` : null
    };
  }

  return urls;
}

function serializeStream(stream, host) {
  return {
    ...stream,
    urls: buildStreamUrls(stream.streamPath, host, true)
  };
}

const nmsConfig = {
  rtmp: {
    port: RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: HTTP_FLV_PORT,
    mediaroot: MEDIA_ROOT,
    allow_origin: '*'
  },
  auth: {
    play: false,
    publish: false
  }
};

if (HLS_ENABLED) {
  nmsConfig.trans = {
    ffmpeg: FFMPEG_PATH,
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        hlsKeep: false
      }
    ]
  };
}

const nms = new NodeMediaServer(nmsConfig);

nms.on('preConnect', (id, args) => {
  console.log('[NMS preConnect]', `id=${id}`, JSON.stringify(args || {}));
});

nms.on('postConnect', (id) => {
  console.log('[NMS postConnect]', `id=${id}`);
});

nms.on('doneConnect', (id) => {
  console.log('[NMS doneConnect]', `id=${id}`);
});

nms.on('prePublish', (id, streamPath, args) => {
  console.log('[NMS prePublish]', `id=${id}`, `stream=${streamPath}`, JSON.stringify(args || {}));
});

nms.on('postPublish', (id, streamPath, args) => {
  const { app: streamApp, key } = parseStreamPath(streamPath);
  const now = new Date().toISOString();
  const localIP = getLocalIP();

  activeStreams.set(streamPath, {
    id,
    app: streamApp,
    key,
    streamPath,
    startTime: now,
    clientInfo: args || {}
  });

  console.log('');
  console.log(`Stream started: ${streamPath}`);
  console.log(`  DJI/RTMP publish: rtmp://${localIP}:${RTMP_PORT}${streamPath}`);
  console.log(`  HTTP-FLV preview: http://${localIP}:${HTTP_FLV_PORT}${streamPath}.flv`);
  if (HLS_ENABLED) {
    console.log(`  HLS fallback:     http://${localIP}:${HTTP_FLV_PORT}${streamPath}/index.m3u8`);
  }
  console.log(`  Dashboard:        http://${localIP}:${DASHBOARD_PORT}`);
  console.log('');
});

nms.on('donePublish', (id, streamPath) => {
  console.log('');
  console.log(`Stream ended: ${streamPath}`);
  console.log('');
  activeStreams.delete(streamPath);
});

nms.on('prePlay', (id, streamPath) => {
  console.log('[NMS prePlay]', `id=${id}`, `stream=${streamPath}`);
});

nms.on('donePlay', (id, streamPath) => {
  console.log('[NMS donePlay]', `id=${id}`, `stream=${streamPath}`);
});

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/streams', (req, res) => {
  const host = getRequestHost(req);
  const streams = Array.from(activeStreams.values())
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .map((stream) => serializeStream(stream, host));

  res.json({
    streams,
    count: streams.length
  });
});

app.get('/api/server', (req, res) => {
  const localIP = getLocalIP();
  const host = getRequestHost(req);

  res.json({
    status: 'running',
    uptime: process.uptime(),
    localIP,
    requestHost: host,
    rtmpPort: RTMP_PORT,
    httpFlvPort: HTTP_FLV_PORT,
    dashboardPort: DASHBOARD_PORT,
    hlsEnabled: HLS_ENABLED,
    ffmpegPath: HLS_ENABLED ? FFMPEG_PATH : null,
    activeStreams: activeStreams.size,
    urls: {
      dashboard: `http://${formatHostForUrl(host)}:${DASHBOARD_PORT}`,
      dashboardLan: `http://${formatHostForUrl(localIP)}:${DASHBOARD_PORT}`,
      rtmpBase: `rtmp://${formatHostForUrl(localIP)}:${RTMP_PORT}/live`,
      defaultPublish: `rtmp://${formatHostForUrl(localIP)}:${RTMP_PORT}/live/drone`,
      defaultHttpFlv: `http://${formatHostForUrl(host)}:${HTTP_FLV_PORT}/live/drone.flv`,
      defaultHls: HLS_ENABLED ? `http://${formatHostForUrl(host)}:${HTTP_FLV_PORT}/live/drone/index.m3u8` : null
    },
    memory: process.memoryUsage()
  });
});

app.get('/api/ip', (req, res) => {
  res.json({ ip: getLocalIP() });
});

app.get('/api/obs-config', (req, res) => {
  const host = getRequestHost(req);
  const streams = Array.from(activeStreams.values()).map((stream) => {
    const urls = buildStreamUrls(stream.streamPath, host, true);

    return {
      name: stream.key,
      rtmpUrl: urls.rtmp,
      streamKey: stream.key,
      httpFlvUrl: urls.httpFlv,
      hlsUrl: urls.hls
    };
  });

  res.json({
    server: {
      rtmpBase: `rtmp://${formatHostForUrl(host)}:${RTMP_PORT}/live`,
      httpFlvBase: `http://${formatHostForUrl(host)}:${HTTP_FLV_PORT}/live`,
      hlsEnabled: HLS_ENABLED
    },
    activeStreams: streams
  });
});

nms.run();

app.listen(DASHBOARD_PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();

  console.log('');
  console.log('DJI Drone RTMP Live Streaming Server');
  console.log('-------------------------------------');
  console.log(`Dashboard local:  http://localhost:${DASHBOARD_PORT}`);
  console.log(`Dashboard LAN:    http://${localIP}:${DASHBOARD_PORT}`);
  console.log(`DJI RTMP URL:     rtmp://${localIP}:${RTMP_PORT}/live/drone`);
  console.log(`HTTP-FLV preview: http://${localIP}:${HTTP_FLV_PORT}/live/drone.flv`);
  console.log(`HLS fallback:     ${HLS_ENABLED ? `http://${localIP}:${HTTP_FLV_PORT}/live/drone/index.m3u8` : 'disabled (FFmpeg not found)'}`);
  console.log('');

  if (!HLS_ENABLED) {
    console.warn('FFmpeg was not found. HLS is disabled, but RTMP and HTTP-FLV live preview still work.');
    console.warn('Install FFmpeg or set FFMPEG_PATH to enable HLS output.');
    console.log('');
  }
});
