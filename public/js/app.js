/*
   DJI Drone RTMP Live Stream Dashboard
   Frontend application
*/

(function () {
    'use strict';

    const CONFIG = {
        API_BASE: window.location.origin,
        POLL_INTERVAL: 3000,
        STATS_INTERVAL: 1000,
        RECONNECT_DELAY: 5000,
        MAX_RECONNECT: 10,
        MAX_LIVE_LATENCY: 1.5,
        TARGET_LIVE_LATENCY: 0.3
    };

    const DEFAULT_SERVER = {
        localIP: '',
        rtmpPort: 1935,
        httpFlvPort: 8000,
        dashboardPort: 3000,
        hlsEnabled: false
    };

    const state = {
        player: null,
        currentStream: null,
        currentPlaybackUrl: '',
        isPlaying: false,
        pollTimer: null,
        statsTimer: null,
        uptimeTimer: null,
        reconnectTimer: null,
        reconnectAttempts: 0,
        serverOnline: false,
        streams: [],
        serverInfo: { ...DEFAULT_SERVER },
        uptimeSnapshot: 0,
        uptimeUpdatedAt: 0
    };

    const DOM = {
        videoPlayer: document.getElementById('videoPlayer'),
        playerOverlay: document.getElementById('playerOverlay'),
        playerContainer: document.getElementById('playerContainer'),
        playerPlaceholder: document.querySelector('.player-placeholder'),
        placeholderText: document.querySelector('.placeholder-text'),
        placeholderHint: document.querySelector('.placeholder-hint'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        fullscreenEnterIcon: document.querySelector('.fullscreen-enter-icon'),
        fullscreenExitIcon: document.querySelector('.fullscreen-exit-icon'),
        liveBadge: document.getElementById('liveBadge'),
        streamTitle: document.getElementById('streamTitle'),
        streamSelector: document.getElementById('streamSelector'),
        serverStatus: document.getElementById('serverStatus'),
        serverUptime: document.getElementById('serverUptime'),
        streamCount: document.getElementById('streamCount'),
        streamStatsOverlay: document.getElementById('streamStatsOverlay'),
        infoStatus: document.getElementById('infoStatus'),
        infoStreamKey: document.getElementById('infoStreamKey'),
        infoDuration: document.getElementById('infoDuration'),
        infoCodec: document.getElementById('infoCodec'),
        infoResolution: document.getElementById('infoResolution'),
        infoFps: document.getElementById('infoFps'),
        infoBitrate: document.getElementById('infoBitrate'),
        infoLatency: document.getElementById('infoLatency'),
        overlayResolution: document.getElementById('overlayResolution'),
        overlayFps: document.getElementById('overlayFps'),
        overlayBitrate: document.getElementById('overlayBitrate'),
        obsRtmpUrl: document.getElementById('obsRtmpUrl'),
        obsFlvUrl: document.getElementById('obsFlvUrl'),
        obsHlsUrl: document.getElementById('obsHlsUrl'),
        djiRtmpUrl: document.getElementById('djiRtmpUrl'),
        lanDashboardUrl: document.getElementById('lanDashboardUrl'),
        serverIp: document.getElementById('serverIp'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    function init() {
        console.log('DJI Live Stream Dashboard initializing...');
        setupCopyButtons();
        setupFullscreenButton();
        updateStaticConnectionUrls();
        startUptimeCounter();
        startPolling();
    }

    function getMediaLibrary() {
        const candidates = [window.mpegts, window.flvjs].filter(Boolean);
        return candidates.find((library) => (
            typeof library.isSupported === 'function' &&
            library.isSupported() &&
            typeof library.createPlayer === 'function'
        )) || null;
    }

    function createPlayer(flvUrl, options = {}) {
        const { resetReconnect = true } = options;
        const mediaLibrary = getMediaLibrary();

        if (!mediaLibrary) {
            showPlayerMessage(
                'Player belum siap',
                'mpegts.js/flv.js tidak termuat. Cek koneksi internet atau gunakan file player lokal.',
                true
            );
            showToast('Library player video tidak termuat', 'error');
            return false;
        }

        destroyPlayer({ clearRetry: false });

        if (resetReconnect) {
            clearReconnectTimer();
            state.reconnectAttempts = 0;
        }

        state.currentPlaybackUrl = flvUrl;
        DOM.videoPlayer.muted = true;

        console.log(`Creating player for: ${flvUrl}`);

        state.player = mediaLibrary.createPlayer({
            type: 'flv',
            url: flvUrl,
            isLive: true,
            hasVideo: true
        }, {
            enableWorker: true,
            enableStashBuffer: false,
            stashInitialSize: 128,
            lazyLoad: false,
            deferLoadAfterSourceOpen: false,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: CONFIG.MAX_LIVE_LATENCY,
            liveBufferLatencyMinRemain: CONFIG.TARGET_LIVE_LATENCY,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 3,
            autoCleanupMinBackwardDuration: 1,
            seekType: 'range'
        });

        state.player.attachMediaElement(DOM.videoPlayer);
        bindPlayerEvents(mediaLibrary);

        state.player.load();
        const playResult = state.player.play();
        if (playResult && typeof playResult.catch === 'function') {
            playResult.catch((error) => {
                console.warn('Autoplay failed:', error);
                showToast('Klik video jika autoplay diblokir browser', 'error');
            });
        }

        state.isPlaying = true;
        DOM.playerOverlay.classList.add('hidden');
        DOM.liveBadge.classList.add('active');
        DOM.streamStatsOverlay.classList.add('visible');
        startStatsTimer();

        return true;
    }

    function bindPlayerEvents(mediaLibrary) {
        const events = mediaLibrary.Events || {};

        if (events.ERROR) {
            state.player.on(events.ERROR, (errorType, errorDetail, errorInfo) => {
                console.error('Player error:', errorType, errorDetail, errorInfo);
                handlePlayerError();
            });
        }

        if (events.LOADING_COMPLETE) {
            state.player.on(events.LOADING_COMPLETE, () => {
                console.log('Loading complete; stream may have ended');
                if (state.currentStream) {
                    handlePlayerError();
                }
            });
        }

        if (events.STATISTICS_INFO) {
            state.player.on(events.STATISTICS_INFO, updatePlayerStats);
        }

        if (events.MEDIA_INFO) {
            state.player.on(events.MEDIA_INFO, updateMediaInfo);
        }
    }

    function destroyPlayer(options = {}) {
        const { clearRetry = true } = options;

        if (clearRetry) {
            clearReconnectTimer();
        }

        if (state.player) {
            try {
                state.player.pause();
                state.player.unload();
                state.player.detachMediaElement();
                state.player.destroy();
            } catch (error) {
                console.warn('Player destroy error:', error);
            }

            state.player = null;
        }

        state.isPlaying = false;
        stopStatsTimer();
    }

    function handlePlayerError() {
        if (!state.currentStream) return;
        if (state.reconnectTimer) return;

        if (state.reconnectAttempts >= CONFIG.MAX_RECONNECT) {
            showPlayerMessage(
                'Stream belum bisa diputar',
                'Reconnect sudah mencapai batas. Pastikan drone mengirim H.264 ke URL RTMP yang benar.',
                true
            );
            showToast('Gagal memutar live stream', 'error');
            destroyPlayer();
            return;
        }

        state.reconnectAttempts += 1;
        showToast(`Reconnect stream ${state.reconnectAttempts}/${CONFIG.MAX_RECONNECT}`, 'error');

        state.reconnectTimer = setTimeout(() => {
            state.reconnectTimer = null;
            const latestStream = findCurrentStream() || state.currentStream;
            createPlayer(getStreamPlaybackUrl(latestStream), { resetReconnect: false });
        }, CONFIG.RECONNECT_DELAY);
    }

    function clearReconnectTimer() {
        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }
    }

    function handleStreamEnd(title = 'Stream berakhir') {
        destroyPlayer();
        state.currentStream = null;
        state.currentPlaybackUrl = '';
        state.reconnectAttempts = 0;
        DOM.playerOverlay.classList.remove('hidden');
        DOM.liveBadge.classList.remove('active');
        DOM.streamStatsOverlay.classList.remove('visible');
        DOM.streamTitle.textContent = title;
        resetInfoPanel();
        updateStaticConnectionUrls();
    }

    function showIdleState() {
        DOM.playerOverlay.classList.remove('hidden');
        DOM.liveBadge.classList.remove('active');
        DOM.streamStatsOverlay.classList.remove('visible');
        DOM.streamTitle.textContent = 'Menunggu Stream...';
        showPlayerMessage(
            'Menunggu drone terhubung...',
            `Push RTMP stream ke ${buildDefaultPublishUrl()}`,
            false
        );
    }

    function showPlayerMessage(message, hint, isError) {
        if (DOM.placeholderText) {
            DOM.placeholderText.textContent = message;
        }

        if (DOM.placeholderHint) {
            DOM.placeholderHint.textContent = hint || '';
            DOM.placeholderHint.classList.toggle('error', Boolean(isError));
        }
    }

    function updatePlayerStats(stats) {
        if (!stats) return;

        const speed = Number(stats.speed);
        const bitrate = Number.isFinite(speed) && speed > 0 ? `${Math.round(speed * 8)} kbps` : '- kbps';
        DOM.overlayBitrate.textContent = bitrate;
        DOM.infoBitrate.textContent = bitrate;
    }

    function updateMediaInfo(mediaInfo) {
        if (!mediaInfo) return;

        if (mediaInfo.width && mediaInfo.height) {
            const resolution = `${mediaInfo.width}x${mediaInfo.height}`;
            DOM.overlayResolution.textContent = resolution;
            DOM.infoResolution.textContent = resolution;
        }

        if (mediaInfo.videoDataRate) {
            DOM.infoBitrate.textContent = `${Math.round(mediaInfo.videoDataRate)} kbps`;
        }

        if (mediaInfo.fps) {
            const fps = `${Math.round(mediaInfo.fps)} fps`;
            DOM.overlayFps.textContent = fps;
            DOM.infoFps.textContent = fps;
        }

        const codec = String(mediaInfo.videoCodec || mediaInfo.mimeType || '').trim();
        if (codec) {
            DOM.infoCodec.textContent = codec;
            const lowerCodec = codec.toLowerCase();
            if (lowerCodec.includes('hevc') || lowerCodec.includes('hvc') || lowerCodec.includes('h265') || lowerCodec.includes('h.265')) {
                showToast('Browser tidak mendukung H.265. Ubah stream drone ke H.264.', 'error');
            }
        }
    }

    function startStatsTimer() {
        stopStatsTimer();
        state.statsTimer = setInterval(() => {
            if (!state.player || !state.isPlaying) return;

            if (state.player.statisticsInfo) {
                updatePlayerStats(state.player.statisticsInfo);
            }

            const video = DOM.videoPlayer;
            if (video.buffered && video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const latency = bufferedEnd - video.currentTime;

                if (Number.isFinite(latency) && latency >= 0) {
                    DOM.infoLatency.textContent = `${latency.toFixed(1)}s`;
                }

                if (latency > CONFIG.MAX_LIVE_LATENCY) {
                    video.currentTime = Math.max(bufferedEnd - CONFIG.TARGET_LIVE_LATENCY, 0);
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

    function startPolling() {
        pollStreams();
        state.pollTimer = setInterval(pollStreams, CONFIG.POLL_INTERVAL);
    }

    async function pollStreams() {
        let streamsLoaded = false;

        try {
            const serverResponse = await fetch(`${CONFIG.API_BASE}/api/server`, { cache: 'no-store' });
            if (serverResponse.ok) {
                applyServerInfo(await serverResponse.json());
            }
        } catch (error) {
            console.warn('Failed to fetch server info:', error);
        }

        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/streams`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`API error ${response.status}`);

            const data = await response.json();
            streamsLoaded = true;
            state.serverOnline = true;
            updateServerStatus(true);
            handleStreamsUpdate(data);
        } catch (error) {
            state.serverOnline = false;
            updateServerStatus(false);
            console.warn('Failed to fetch streams:', error);
        }

        if (!streamsLoaded && !state.currentStream) {
            DOM.streamCount.textContent = '-';
        }
    }

    function applyServerInfo(serverInfo) {
        state.serverInfo = {
            ...state.serverInfo,
            ...serverInfo
        };

        if (serverInfo.localIP) {
            state.serverInfo.localIP = serverInfo.localIP;
        }

        if (typeof serverInfo.uptime === 'number') {
            state.uptimeSnapshot = serverInfo.uptime;
            state.uptimeUpdatedAt = Date.now();
            updateServerUptime(serverInfo.uptime);
        }

        updateStaticConnectionUrls();
        if (state.currentStream) {
            updateOBSUrls(state.currentStream);
        }
    }

    function handleStreamsUpdate(data) {
        const streams = Array.isArray(data.streams) ? data.streams : [];
        state.streams = streams;
        DOM.streamCount.textContent = streams.length;
        updateStreamSelector(streams);

        if (state.currentStream) {
            const stillActive = findCurrentStream();
            if (!stillActive) {
                handleStreamEnd('Stream berakhir');
                if (streams.length === 0) {
                    showIdleState();
                }
                return;
            }

            state.currentStream = stillActive;
            updateStreamDuration(stillActive.startTime);
            updateOBSUrls(stillActive);
            return;
        }

        if (streams.length > 0) {
            selectStream(streams[0]);
        } else {
            resetInfoPanel();
            showIdleState();
        }
    }

    function updateStreamSelector(streams) {
        const currentValue = DOM.streamSelector.value;

        while (DOM.streamSelector.options.length > 1) {
            DOM.streamSelector.remove(1);
        }

        streams.forEach((stream) => {
            const option = document.createElement('option');
            option.value = stream.streamPath;
            option.textContent = `${stream.key} (${stream.app})`;
            if (stream.streamPath === currentValue) {
                option.selected = true;
            }
            DOM.streamSelector.appendChild(option);
        });

        DOM.streamSelector.onchange = (event) => {
            const selectedPath = event.target.value;
            if (!selectedPath) return;

            const stream = streams.find((item) => item.streamPath === selectedPath);
            if (stream) {
                selectStream(stream);
            }
        };
    }

    function findCurrentStream() {
        if (!state.currentStream) return null;
        return state.streams.find((stream) => stream.streamPath === state.currentStream.streamPath) || null;
    }

    function selectStream(stream) {
        state.currentStream = stream;
        state.reconnectAttempts = 0;
        DOM.streamTitle.textContent = `${stream.key} - Live`;
        setInfoStatus(true);
        DOM.infoStreamKey.textContent = stream.key || '-';
        updateStreamDuration(stream.startTime);
        updateOBSUrls(stream);
        resetPlayerMetrics();

        const playbackUrl = getStreamPlaybackUrl(stream);
        createPlayer(playbackUrl, { resetReconnect: true });
        DOM.streamSelector.value = stream.streamPath;
    }

    function updateOBSUrls(stream) {
        const obsHost = getPlaybackHost();
        const streamPath = stream.streamPath || '/live/drone';
        const urls = stream.urls || {};

        DOM.obsRtmpUrl.textContent = rewriteUrlHost(
            urls.rtmp || buildUrl('rtmp', obsHost, getPort('rtmpPort'), streamPath),
            obsHost
        );

        DOM.obsFlvUrl.textContent = rewriteUrlHost(
            urls.httpFlv || buildUrl('http', obsHost, getPort('httpFlvPort'), `${streamPath}.flv`),
            obsHost
        );

        const hlsUrl = urls.hls || (
            state.serverInfo.hlsEnabled
                ? buildUrl('http', obsHost, getPort('httpFlvPort'), `${streamPath}/index.m3u8`)
                : ''
        );
        DOM.obsHlsUrl.textContent = hlsUrl ? rewriteUrlHost(hlsUrl, obsHost) : 'HLS nonaktif - install FFmpeg';
    }

    function getStreamPlaybackUrl(stream) {
        const playbackHost = getPlaybackHost();
        const fallbackUrl = buildUrl('http', playbackHost, getPort('httpFlvPort'), `${stream.streamPath}.flv`);
        return rewriteUrlHost(stream.urls && stream.urls.httpFlv ? stream.urls.httpFlv : fallbackUrl, playbackHost);
    }

    function updateStaticConnectionUrls() {
        const publishUrl = buildDefaultPublishUrl();
        const lanDashboardUrl = buildLanDashboardUrl();

        DOM.serverIp.textContent = getPublishHost();
        DOM.djiRtmpUrl.textContent = publishUrl;
        DOM.lanDashboardUrl.textContent = lanDashboardUrl;

        if (!state.currentStream) {
            const obsHost = getPlaybackHost();
            DOM.obsRtmpUrl.textContent = buildUrl('rtmp', obsHost, getPort('rtmpPort'), '/live/drone');
            DOM.obsFlvUrl.textContent = buildUrl('http', obsHost, getPort('httpFlvPort'), '/live/drone.flv');
            DOM.obsHlsUrl.textContent = state.serverInfo.hlsEnabled
                ? buildUrl('http', obsHost, getPort('httpFlvPort'), '/live/drone/index.m3u8')
                : 'HLS nonaktif - install FFmpeg';
        }

        if (!state.currentStream && DOM.placeholderHint) {
            DOM.placeholderHint.textContent = `Push RTMP stream ke ${publishUrl}`;
        }
    }

    function buildDefaultPublishUrl() {
        return buildUrl('rtmp', getPublishHost(), getPort('rtmpPort'), '/live/drone');
    }

    function buildLanDashboardUrl() {
        const host = state.serverInfo.localIP || getPublishHost();
        return buildUrl('http', host, getPort('dashboardPort'), '');
    }

    function buildUrl(protocol, host, port, urlPath) {
        return `${protocol}://${formatHostForUrl(host)}:${port}${urlPath}`;
    }

    function rewriteUrlHost(rawUrl, host) {
        if (!rawUrl) return rawUrl;
        return rawUrl.replace(/\/\/(\[[^\]]+\]|[^/:]+)(?=:)/, `//${formatHostForUrl(host)}`);
    }

    function formatHostForUrl(host) {
        if (!host) return 'localhost';
        return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    }

    function getBrowserHost() {
        return window.location.hostname || '';
    }

    function getPlaybackHost() {
        return getBrowserHost() || state.serverInfo.localIP || 'localhost';
    }

    function getPublishHost() {
        const browserHost = getBrowserHost();
        if (isLocalHost(browserHost) && state.serverInfo.localIP) {
            return state.serverInfo.localIP;
        }

        return browserHost || state.serverInfo.localIP || 'localhost';
    }

    function isLocalHost(host) {
        return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    }

    function getPort(name) {
        return Number(state.serverInfo[name]) || DEFAULT_SERVER[name];
    }

    function setupFullscreenButton() {
        if (!DOM.fullscreenBtn) return;

        DOM.fullscreenBtn.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', updateFullscreenButton);
        document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
        updateFullscreenButton();
    }

    async function toggleFullscreen() {
        const fullscreenElement = getFullscreenElement();

        try {
            if (fullscreenElement) {
                await exitFullscreen();
            } else {
                await enterFullscreen(DOM.playerContainer);
            }
        } catch (error) {
            console.warn('Fullscreen failed:', error);
            showToast('Fullscreen tidak didukung browser ini', 'error');
        }
    }

    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    async function enterFullscreen(element) {
        if (element.requestFullscreen) {
            await element.requestFullscreen();
            return;
        }

        if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
            return;
        }

        if (DOM.videoPlayer.webkitEnterFullscreen) {
            DOM.videoPlayer.webkitEnterFullscreen();
            return;
        }

        throw new Error('Fullscreen API unavailable');
    }

    async function exitFullscreen() {
        if (document.exitFullscreen) {
            await document.exitFullscreen();
            return;
        }

        if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }

    function updateFullscreenButton() {
        const isFullscreen = Boolean(getFullscreenElement());

        DOM.playerContainer.classList.toggle('is-fullscreen', isFullscreen);
        DOM.fullscreenBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Fullscreen');
        DOM.fullscreenBtn.setAttribute('title', isFullscreen ? 'Exit fullscreen' : 'Fullscreen');
        DOM.fullscreenEnterIcon.classList.toggle('hidden', isFullscreen);
        DOM.fullscreenExitIcon.classList.toggle('hidden', !isFullscreen);
    }

    function updateServerStatus(online) {
        DOM.serverStatus.classList.toggle('offline', !online);
        DOM.serverStatus.querySelector('span').textContent = online ? 'Server Online' : 'Server Offline';
    }

    function startUptimeCounter() {
        state.uptimeTimer = setInterval(() => {
            if (!state.uptimeUpdatedAt) return;
            const elapsed = (Date.now() - state.uptimeUpdatedAt) / 1000;
            updateServerUptime(state.uptimeSnapshot + elapsed);
        }, 1000);
    }

    function updateServerUptime(uptimeSeconds) {
        DOM.serverUptime.textContent = formatDuration(uptimeSeconds);
    }

    function updateStreamDuration(startTimeISO) {
        const start = new Date(startTimeISO).getTime();
        if (!Number.isFinite(start)) return;

        const seconds = Math.max(Math.floor((Date.now() - start) / 1000), 0);
        DOM.infoDuration.textContent = formatDuration(seconds);
    }

    function setInfoStatus(online) {
        const badge = document.createElement('span');
        badge.className = `status-badge ${online ? 'online' : 'offline'}`;
        badge.textContent = online ? 'Live' : 'Offline';
        DOM.infoStatus.replaceChildren(badge);
    }

    function resetInfoPanel() {
        setInfoStatus(false);
        DOM.infoStreamKey.textContent = '-';
        DOM.infoDuration.textContent = '00:00:00';
        DOM.infoCodec.textContent = '-';
        resetPlayerMetrics();
    }

    function resetPlayerMetrics() {
        DOM.infoResolution.textContent = '-';
        DOM.infoFps.textContent = '-';
        DOM.infoBitrate.textContent = '-';
        DOM.infoLatency.textContent = '-';
        DOM.overlayResolution.textContent = '-';
        DOM.overlayFps.textContent = '- fps';
        DOM.overlayBitrate.textContent = '- kbps';
    }

    function setupCopyButtons() {
        document.querySelectorAll('.copy-btn').forEach((button) => {
            button.addEventListener('click', async () => {
                const target = document.getElementById(button.dataset.target);
                if (!target) return;

                const text = target.textContent.trim();
                try {
                    await navigator.clipboard.writeText(text);
                    markCopied(button);
                } catch (error) {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    markCopied(button);
                }
            });
        });
    }

    function markCopied(button) {
        button.classList.add('copied');
        showToast('URL berhasil disalin!');
        setTimeout(() => button.classList.remove('copied'), 2000);
    }

    let toastTimeout;
    function showToast(message, type = 'success') {
        clearTimeout(toastTimeout);
        DOM.toastMessage.textContent = message;
        DOM.toast.classList.toggle('error', type === 'error');
        DOM.toast.classList.add('show');
        toastTimeout = setTimeout(() => {
            DOM.toast.classList.remove('show');
        }, 2800);
    }

    function formatDuration(totalSeconds) {
        const safeSeconds = Math.max(Math.floor(Number(totalSeconds) || 0), 0);
        const hours = Math.floor(safeSeconds / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const seconds = safeSeconds % 60;

        return [hours, minutes, seconds]
            .map((value) => String(value).padStart(2, '0'))
            .join(':');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
