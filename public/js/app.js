/* ═══════════════════════════════════════════════════════
   DJI Drone RTMP Live Stream Dashboard
   Frontend Application
   ═══════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ─── Configuration ─── */
    const CONFIG = {
        API_BASE: window.location.origin,
        HTTP_FLV_BASE: `http://${window.location.hostname}:8000`,
        RTMP_BASE: `rtmp://${window.location.hostname}:1935`,
        POLL_INTERVAL: 3000,      // Poll for streams every 3s
        STATS_INTERVAL: 1000,     // Update stats every 1s
        RECONNECT_DELAY: 5000,    // Reconnect player after 5s
        MAX_RECONNECT: 10
    };

    /* ─── State ─── */
    const state = {
        player: null,
        currentStream: null,
        isPlaying: false,
        pollTimer: null,
        statsTimer: null,
        uptimeTimer: null,
        reconnectAttempts: 0,
        serverOnline: false,
        streams: [],
        localIP: ''
    };

    /* ─── DOM Elements ─── */
    const DOM = {
        videoPlayer: document.getElementById('videoPlayer'),
        playerOverlay: document.getElementById('playerOverlay'),
        playerContainer: document.getElementById('playerContainer'),
        liveBadge: document.getElementById('liveBadge'),
        streamTitle: document.getElementById('streamTitle'),
        streamSelector: document.getElementById('streamSelector'),
        serverStatus: document.getElementById('serverStatus'),
        serverUptime: document.getElementById('serverUptime'),
        streamCount: document.getElementById('streamCount'),
        streamStatsOverlay: document.getElementById('streamStatsOverlay'),
        // Info panel
        infoStatus: document.getElementById('infoStatus'),
        infoStreamKey: document.getElementById('infoStreamKey'),
        infoDuration: document.getElementById('infoDuration'),
        infoCodec: document.getElementById('infoCodec'),
        infoResolution: document.getElementById('infoResolution'),
        infoFps: document.getElementById('infoFps'),
        infoBitrate: document.getElementById('infoBitrate'),
        infoLatency: document.getElementById('infoLatency'),
        // Overlay stats
        overlayResolution: document.getElementById('overlayResolution'),
        overlayFps: document.getElementById('overlayFps'),
        overlayBitrate: document.getElementById('overlayBitrate'),
        // OBS URLs
        obsRtmpUrl: document.getElementById('obsRtmpUrl'),
        obsFlvUrl: document.getElementById('obsFlvUrl'),
        obsHlsUrl: document.getElementById('obsHlsUrl'),
        djiRtmpUrl: document.getElementById('djiRtmpUrl'),
        serverIp: document.getElementById('serverIp'),
        // Toast
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    /* ─── Initialize ─── */
    function init() {
        console.log('🚁 DJI Live Stream Dashboard initializing...');
        setupCopyButtons();
        detectLocalIP();
        startPolling();
        startUptimeCounter();
    }

    /* ─── FLV.js Player ─── */
    function createPlayer(flvUrl) {
        if (!flvjs.isSupported()) {
            console.error('FLV.js is not supported in this browser');
            showToast('Browser tidak mendukung FLV playback', 'error');
            return;
        }

        destroyPlayer();

        console.log(`🎬 Creating player for: ${flvUrl}`);

        state.player = flvjs.createPlayer({
            type: 'flv',
            url: flvUrl,
            isLive: true,
            hasAudio: false,
            hasVideo: true,
            enableStashBuffer: false,
            stashInitialSize: 128,
            enableWorker: true,
            lazyLoadMaxDuration: 3 * 60,
            seekType: 'range',
        }, {
            enableWorker: true,
            lazyLoadMaxDuration: 3 * 60,
            seekType: 'range',
        });

        state.player.attachMediaElement(DOM.videoPlayer);

        // Event handlers
        state.player.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
            console.error('Player error:', errorType, errorDetail, errorInfo);
            handlePlayerError();
        });

        state.player.on(flvjs.Events.LOADING_COMPLETE, () => {
            console.log('Loading complete — stream may have ended');
            handleStreamEnd();
        });

        state.player.on(flvjs.Events.STATISTICS_INFO, (stats) => {
            updatePlayerStats(stats);
        });

        state.player.on(flvjs.Events.MEDIA_INFO, (mediaInfo) => {
            updateMediaInfo(mediaInfo);
        });

        state.player.load();
        state.player.play();

        state.isPlaying = true;
        state.reconnectAttempts = 0;

        // Show video, hide overlay
        DOM.playerOverlay.classList.add('hidden');
        DOM.liveBadge.classList.add('active');
        DOM.streamStatsOverlay.classList.add('visible');

        // Start stats polling
        startStatsTimer();
    }

    function destroyPlayer() {
        if (state.player) {
            try {
                state.player.pause();
                state.player.unload();
                state.player.detachMediaElement();
                state.player.destroy();
            } catch (e) {
                console.warn('Player destroy error:', e);
            }
            state.player = null;
        }
        state.isPlaying = false;
        stopStatsTimer();
    }

    function handlePlayerError() {
        if (state.reconnectAttempts < CONFIG.MAX_RECONNECT) {
            state.reconnectAttempts++;
            console.log(`🔄 Reconnecting... attempt ${state.reconnectAttempts}/${CONFIG.MAX_RECONNECT}`);
            setTimeout(() => {
                if (state.currentStream) {
                    createPlayer(state.currentStream.urls.httpFlv);
                }
            }, CONFIG.RECONNECT_DELAY);
        } else {
            console.error('Max reconnect attempts reached');
            handleStreamEnd();
        }
    }

    function handleStreamEnd() {
        destroyPlayer();
        DOM.playerOverlay.classList.remove('hidden');
        DOM.liveBadge.classList.remove('active');
        DOM.streamStatsOverlay.classList.remove('visible');
        DOM.streamTitle.textContent = 'Stream berakhir';
        state.currentStream = null;
        resetInfoPanel();
    }

    /* ─── Player Stats ─── */
    function updatePlayerStats(stats) {
        if (!stats) return;

        const speed = stats.speed ? `${Math.round(stats.speed)} kbps` : '- kbps';
        DOM.overlayBitrate.textContent = speed;
        DOM.infoBitrate.textContent = speed;
    }

    function updateMediaInfo(mediaInfo) {
        if (!mediaInfo) return;

        // Video info
        if (mediaInfo.width && mediaInfo.height) {
            const res = `${mediaInfo.width}x${mediaInfo.height}`;
            DOM.overlayResolution.textContent = res;
            DOM.infoResolution.textContent = res;
        }

        if (mediaInfo.videoDataRate) {
            DOM.infoBitrate.textContent = `${Math.round(mediaInfo.videoDataRate)} kbps`;
        }

        // FPS
        if (mediaInfo.fps) {
            const fps = `${Math.round(mediaInfo.fps)} fps`;
            DOM.overlayFps.textContent = fps;
            DOM.infoFps.textContent = fps;
        }

        // Codec
        if (mediaInfo.videoCodec) {
            DOM.infoCodec.textContent = mediaInfo.videoCodec;
            if (mediaInfo.videoCodec.toLowerCase().includes('hevc') || mediaInfo.videoCodec.toLowerCase().includes('hvc')) {
                showToast('HEVC/H.265 tidak didukung browser. Ubah ke H.264 di setting kamera drone!', 'error');
            }
        }
    }

    function startStatsTimer() {
        stopStatsTimer();
        state.statsTimer = setInterval(() => {
            if (state.player && state.isPlaying) {
                const stats = state.player.statisticsInfo;
                if (stats) {
                    updatePlayerStats(stats);
                }

                // Update latency
                if (DOM.videoPlayer.buffered && DOM.videoPlayer.buffered.length > 0) {
                    const bufferedEnd = DOM.videoPlayer.buffered.end(DOM.videoPlayer.buffered.length - 1);
                    const latency = bufferedEnd - DOM.videoPlayer.currentTime;
                    DOM.infoLatency.textContent = `${latency.toFixed(1)}s`;

                    // Auto-chase live edge if latency > 5s
                    if (latency > 5) {
                        DOM.videoPlayer.currentTime = bufferedEnd - 0.5;
                    }
                }
            }
        }, CONFIG.STATS_INTERVAL);
    }

    function stopStatsTimer() {
        if (state.statsTimer) {
            clearInterval(state.statsTimer);
            state.statsTimer = null;
        }
    }

    /* ─── Stream Polling ─── */
    function startPolling() {
        pollStreams();
        state.pollTimer = setInterval(pollStreams, CONFIG.POLL_INTERVAL);
    }

    async function pollStreams() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/streams`);
            if (!response.ok) throw new Error('API error');

            const data = await response.json();
            state.serverOnline = true;
            updateServerStatus(true);
            handleStreamsUpdate(data);
        } catch (error) {
            state.serverOnline = false;
            updateServerStatus(false);
        }

        // Also poll server info
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/server`);
            if (response.ok) {
                const serverInfo = await response.json();
                updateServerUptime(serverInfo.uptime);
            }
        } catch (e) { /* silent */ }
    }

    function handleStreamsUpdate(data) {
        const { streams, count } = data;
        DOM.streamCount.textContent = count;

        // Update stream selector
        updateStreamSelector(streams);

        // Auto-connect to first stream if none selected
        if (count > 0 && !state.currentStream) {
            const stream = streams[0];
            selectStream(stream);
        }

        // Check if current stream is still active
        if (state.currentStream) {
            const stillActive = streams.find(s => s.streamPath === state.currentStream.streamPath);
            if (!stillActive) {
                handleStreamEnd();
            } else {
                // Update duration
                updateStreamDuration(stillActive.startTime);
            }
        }

        state.streams = streams;
    }

    function updateStreamSelector(streams) {
        const currentValue = DOM.streamSelector.value;

        // Clear options except default
        while (DOM.streamSelector.options.length > 1) {
            DOM.streamSelector.remove(1);
        }

        streams.forEach(stream => {
            const option = document.createElement('option');
            option.value = stream.streamPath;
            option.textContent = `📡 ${stream.key} (${stream.app})`;
            if (stream.streamPath === currentValue) {
                option.selected = true;
            }
            DOM.streamSelector.appendChild(option);
        });

        // Handle selector change
        DOM.streamSelector.onchange = (e) => {
            const selectedPath = e.target.value;
            if (!selectedPath) return;

            const stream = streams.find(s => s.streamPath === selectedPath);
            if (stream) {
                selectStream(stream);
            }
        };
    }

    function selectStream(stream) {
        state.currentStream = stream;
        DOM.streamTitle.textContent = `${stream.key} — Live`;

        // Update info panel
        DOM.infoStatus.innerHTML = '<span class="status-badge online">● Live</span>';
        DOM.infoStreamKey.textContent = stream.key;

        // Update OBS URLs
        updateOBSUrls(stream);

        // Create player
        const ipToUse = state.localIP || window.location.hostname;
        const flvUrl = stream.urls.httpFlv.replace('localhost', ipToUse);
        createPlayer(flvUrl);

        // Set selector value
        DOM.streamSelector.value = stream.streamPath;
    }

    function updateOBSUrls(stream) {
        const ipToUse = state.localIP || window.location.hostname;
        DOM.obsRtmpUrl.textContent = stream.urls.rtmp.replace('localhost', ipToUse);
        DOM.obsFlvUrl.textContent = stream.urls.httpFlv.replace('localhost', ipToUse);
        DOM.obsHlsUrl.textContent = stream.urls.hls.replace('localhost', ipToUse);
    }

    /* ─── Server Status ─── */
    function updateServerStatus(online) {
        if (online) {
            DOM.serverStatus.classList.remove('offline');
            DOM.serverStatus.querySelector('span').textContent = 'Server Online';
        } else {
            DOM.serverStatus.classList.add('offline');
            DOM.serverStatus.querySelector('span').textContent = 'Server Offline';
        }
    }

    let serverStartTime = Date.now();

    function startUptimeCounter() {
        state.uptimeTimer = setInterval(() => {
            // Uptime is fetched from server; this is a fallback
        }, 1000);
    }

    function updateServerUptime(uptimeSeconds) {
        DOM.serverUptime.textContent = formatDuration(uptimeSeconds);
    }

    function updateStreamDuration(startTimeISO) {
        const start = new Date(startTimeISO).getTime();
        const now = Date.now();
        const seconds = Math.floor((now - start) / 1000);
        DOM.infoDuration.textContent = formatDuration(seconds);
    }

    /* ─── Info Panel Reset ─── */
    function resetInfoPanel() {
        DOM.infoStatus.innerHTML = '<span class="status-badge offline">Offline</span>';
        DOM.infoStreamKey.textContent = '-';
        DOM.infoDuration.textContent = '00:00:00';
        DOM.infoCodec.textContent = '-';
        DOM.infoResolution.textContent = '-';
        DOM.infoFps.textContent = '-';
        DOM.infoBitrate.textContent = '-';
        DOM.infoLatency.textContent = '-';
        DOM.overlayResolution.textContent = '-';
        DOM.overlayFps.textContent = '- fps';
        DOM.overlayBitrate.textContent = '- kbps';
    }

    /* ─── IP Detection ─── */
    async function detectLocalIP() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/ip`);
            if (response.ok) {
                const data = await response.json();
                if (data.ip) {
                    state.localIP = data.ip;
                }
            }
        } catch (e) {
            console.warn('Failed to fetch local IP, falling back to hostname');
        }

        const ipToUse = state.localIP || window.location.hostname || 'YOUR_IP';
        DOM.serverIp.textContent = ipToUse;

        // Update DJI URL
        const rtmpUrl = `rtmp://${ipToUse}:1935/live/drone`;
        DOM.djiRtmpUrl.textContent = rtmpUrl;

        // Update OBS URLs if stream is active
        if (state.currentStream) {
            updateOBSUrls(state.currentStream);
        }
    }

    /* ─── Copy to Clipboard ─── */
    function setupCopyButtons() {
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const targetId = btn.dataset.target;
                const targetEl = document.getElementById(targetId);
                if (!targetEl) return;

                const text = targetEl.textContent.trim();

                try {
                    await navigator.clipboard.writeText(text);
                    btn.classList.add('copied');
                    showToast('URL berhasil disalin!');

                    setTimeout(() => {
                        btn.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    // Fallback
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);

                    btn.classList.add('copied');
                    showToast('URL berhasil disalin!');
                    setTimeout(() => btn.classList.remove('copied'), 2000);
                }
            });
        });
    }

    /* ─── Toast ─── */
    let toastTimeout;
    function showToast(message) {
        clearTimeout(toastTimeout);
        DOM.toastMessage.textContent = message;
        DOM.toast.classList.add('show');
        toastTimeout = setTimeout(() => {
            DOM.toast.classList.remove('show');
        }, 2500);
    }

    /* ─── Utilities ─── */
    function formatDuration(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return [hours, minutes, seconds]
            .map(v => String(v).padStart(2, '0'))
            .join(':');
    }

    /* ─── Start ─── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
