/**
 * SignageOS — Player Core v4 (Firebase)
 * Escuta mudanças em tempo real do Firestore.
 */

const SignagePlayer = (() => {
  let ytPlayer         = null;
  let ytReady          = false;
  let isPlayingAd      = false;
  let adQueue          = [];
  let adQueueIndex     = 0;
  let adCountdownTimer = null;
  let skipTimeout      = null;
  let adElapsed        = 0;
  let config           = null;
  let userInteracted   = false;

  let _scheduleInterval = null;
  let _scheduleTimeout  = null;
  let nextAdAt          = null;

  const $ = id => document.getElementById(id);
  const dom = {};

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    dom.ytWrapper         = $('ytWrapper');
    dom.adContainer       = $('adContainer');
    dom.adVideo           = $('adVideo');
    dom.adProgressBar     = $('adProgressBar');
    dom.adCountdown       = $('adCountdown');
    dom.adTitle           = $('adTitle');
    dom.skipBtn           = $('skipBtn');
    dom.transitionOverlay = $('transitionOverlay');
    dom.statusDot         = $('statusDot');
    dom.statusLabel       = $('statusLabel');
    dom.nextAdTimer       = $('nextAdTimer');
    dom.statusBar         = $('statusBar');
    dom.clockDisplay      = $('clockDisplay');
    dom.tapOverlay        = $('tapOverlay');
    dom.loadingOverlay    = $('loadingOverlay');

    // Garante fullscreen ao iniciar
    exitPip();
    dom.adContainer.classList.add('hidden');
    dom.transitionOverlay.classList.remove('active');
    isPlayingAd = false;

    startClock();

    // Mostra botão IMEDIATAMENTE — não espera Firebase
    setupTapToStart();

    // Firebase carrega em background
    Storage.onReady(async () => {
      config = await Storage.getConfig();
      applyConfig();
      buildAdQueue();
      startRealtimeListeners();
      hideLoading();
      console.log('[SignageOS] Firebase ready');
      // Se usuário já tocou, inicia YouTube agora
      if (userInteracted && !ytPlayer) {
        if (typeof YT !== 'undefined' && YT.Player) loadYouTubeSource();
      }
    });
  }

  function hideLoading() {
    if (dom.loadingOverlay) {
      dom.loadingOverlay.style.opacity = '0';
      setTimeout(() => dom.loadingOverlay && dom.loadingOverlay.classList.add('hidden'), 500);
    }
  }

  /* ═══════════════════════════════════════════
     REALTIME LISTENERS (Firebase)
  ═══════════════════════════════════════════ */
  function startRealtimeListeners() {
    // Escuta mudanças de config em tempo real
    Storage.listenConfig(async newConfig => {
      const oldVideoId    = config?.youtube?.videoId;
      const oldPlaylistId = config?.youtube?.playlistId;
      config = newConfig;
      applyConfig();

      // Se mudou o vídeo/playlist, atualiza o YouTube
      if (ytReady && (newConfig.youtube.videoId !== oldVideoId ||
                      newConfig.youtube.playlistId !== oldPlaylistId)) {
        loadYouTubeSource();
      }

      // Reinicia agendamento se intervalo mudou
      if (!isPlayingAd) scheduleNextAd();
      showToast('Configurações atualizadas');
    });

    // Escuta mudanças nos anúncios em tempo real
    Storage.listenAds(ads => {
      buildAdQueueFromList(ads);
      showToast('Anúncios atualizados');
    });

    // Escuta comandos do Admin (mesma aba ou aba diferente)
    Storage.onMessage(msg => {
      switch (msg.type) {
        case 'FORCE_AD':
          clearSchedule();
          triggerAdSequence();
          break;
        case 'RESET_TIMER':
          if (!isPlayingAd) scheduleNextAd();
          break;
      }
    });
  }

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  function applyConfig() {
    if (!config) return;
    if (!config.ui?.showStatusBar) {
      dom.statusBar && dom.statusBar.classList.add('hide');
    } else {
      dom.statusBar && dom.statusBar.classList.remove('hide');
    }
  }

  /* ═══════════════════════════════════════════
     CLOCK
  ═══════════════════════════════════════════ */
  function startClock() {
    const tick = () => {
      if (dom.clockDisplay) {
        dom.clockDisplay.textContent = new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════
     SAFARI TAP TO START
  ═══════════════════════════════════════════ */
  function setupTapToStart() {
    const overlay = dom.tapOverlay;
    if (!overlay) { userInteracted = true; return; }

    // Sempre mostra o tap overlay — necessário para autoplay em todos os browsers
    overlay.style.display = 'flex';

    const start = async () => {
      userInteracted = true;
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.5s ease';
      setTimeout(() => { overlay.style.display = 'none'; }, 500);

      // Se config ainda não carregou, usa default e inicia
      if (!config) {
        config = Storage.DEFAULT_CONFIG;
        applyConfig();
      }

      if (typeof YT !== 'undefined' && YT.Player) {
        loadYouTubeSource();
      } else {
        const check = setInterval(() => {
          if (typeof YT !== 'undefined' && YT.Player) {
            clearInterval(check);
            loadYouTubeSource();
          }
        }, 200);
      }
    };

    overlay.addEventListener('click', start, { once: true });
    overlay.addEventListener('touchend', start, { once: true });
  }

  /* ═══════════════════════════════════════════
     YOUTUBE
  ═══════════════════════════════════════════ */
  window.onYouTubeIframeAPIReady = function () {
    if (!userInteracted) return;
    if (!config) {
      Storage.onReady(async () => {
        config = await Storage.getConfig();
        loadYouTubeSource();
      });
      return;
    }
    loadYouTubeSource();
  };

  function loadYouTubeSource() {
    const yt         = config.youtube;
    const videoId    = yt.videoId    || 'q8LE5H0UJz8';
    const playlistId = yt.playlistId || '';

    const playerVars = {
      autoplay: 1, mute: 1, controls: 0, disablekb: 1,
      fs: 0, iv_load_policy: 3, loop: 1, rel: 0,
      modestbranding: 1, start: yt.startAt || 0,
      playsinline: 1, enablejsapi: 1,
      origin: window.location.origin,
    };

    if (playlistId) {
      playerVars.listType = 'playlist';
      playerVars.list     = playlistId;
      delete playerVars.loop;
    } else {
      playerVars.playlist = videoId;
    }

    if (ytPlayer && ytReady) {
      // Já existe player, só troca o vídeo
      try {
        if (playlistId) {
          ytPlayer.loadPlaylist({ list: playlistId, listType: 'playlist' });
        } else {
          ytPlayer.loadVideoById({ videoId, startSeconds: yt.startAt || 0 });
        }
      } catch(e) {}
      return;
    }

    // Cria player do zero
    ytPlayer = new YT.Player('ytPlayer', {
      videoId: playlistId ? undefined : videoId,
      playerVars,
      events: {
        onReady:       onYTReady,
        onStateChange: onYTStateChange,
        onError:       onYTError,
      },
    });
  }

  function onYTReady(e) {
    ytReady = true;
    e.target.playVideo();
    scheduleNextAd();
    showToast('Player iniciado ✓');
  }

  function onYTStateChange(e) {
    if (isPlayingAd) return;
    if (e.data === YT.PlayerState.ENDED) {
      setTimeout(() => {
        try { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); } catch(err) {}
      }, 500);
    }
  }

  function onYTError(e) {
    console.warn('[SignageOS] YouTube error:', e.data);
  }

  function resumeYouTube() {
    if (!ytPlayer) return;
    try {
      const state = ytPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING) return;
      ytPlayer.playVideo();
    } catch (e) {
      ytReady = false;
      const container = $('ytPlayer');
      if (container) container.innerHTML = '';
      setTimeout(() => window.onYouTubeIframeAPIReady(), 400);
    }
  }

  /* ═══════════════════════════════════════════
     AD QUEUE
  ═══════════════════════════════════════════ */
  async function buildAdQueue() {
    const ads = await Storage.getActiveAds();
    buildAdQueueFromList(ads);
  }

  function buildAdQueueFromList(allAds) {
    const activeAds = allAds.filter(a => a.active);
    if (!activeAds.length) { adQueue = []; return; }

    const rotation = config?.schedule?.rotation || 'sequential';
    if (rotation === 'priority') {
      adQueue = [...activeAds].sort((a, b) => b.priority - a.priority);
    } else if (rotation === 'random') {
      adQueue = shuffle([...activeAds]);
    } else {
      adQueue = [...activeAds];
    }
    adQueueIndex = 0;
  }

  function getNextAd() {
    if (!adQueue.length) return null;
    const ad = adQueue[adQueueIndex % adQueue.length];
    adQueueIndex++;
    if (adQueueIndex >= adQueue.length) {
      adQueueIndex = 0;
      if (config?.schedule?.rotation === 'random') adQueue = shuffle(adQueue);
    }
    return ad;
  }

  /* ═══════════════════════════════════════════
     SCHEDULING
  ═══════════════════════════════════════════ */
  function scheduleNextAd() {
    clearSchedule();
    const intervalMs = (config?.schedule?.intervalMinutes || 2) * 60 * 1000;
    nextAdAt = Date.now() + intervalMs;

    _scheduleInterval = setInterval(updateCountdownDisplay, 1000);
    _scheduleTimeout  = setTimeout(() => {
      clearInterval(_scheduleInterval);
      triggerAdSequence();
    }, intervalMs);

    updateCountdownDisplay();
  }

  function clearSchedule() {
    clearInterval(_scheduleInterval);
    clearTimeout(_scheduleTimeout);
    _scheduleInterval = null;
    _scheduleTimeout  = null;
    if (dom.nextAdTimer) dom.nextAdTimer.textContent = '';
  }

  function updateCountdownDisplay() {
    if (!nextAdAt || !dom.nextAdTimer) return;
    const rem = Math.max(0, Math.round((nextAdAt - Date.now()) / 1000));
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    dom.nextAdTimer.textContent = `PRÓX ${m}:${String(s).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════════
     AD SEQUENCE
  ═══════════════════════════════════════════ */
  async function triggerAdSequence() {
    const maxSeq = config?.schedule?.maxSequential || 1;
    for (let i = 0; i < maxSeq; i++) {
      const ad = getNextAd();
      if (!ad) break;
      await playAd(ad);
      if (i < maxSeq - 1) await sleep(500);
    }
    scheduleNextAd();
  }

  /* ═══════════════════════════════════════════
     PLAY AD
  ═══════════════════════════════════════════ */
  function playAd(ad) {
    return new Promise(resolve => {
      if (isPlayingAd) { resolve(); return; }
      isPlayingAd = true;

      dom.transitionOverlay.classList.add('active');

      setTimeout(() => {
        enterPip();

        dom.adVideo.muted = false;
        dom.adVideo.src   = ad.url;
        dom.adVideo.load();

        if (dom.adTitle) dom.adTitle.textContent = ad.name;
        dom.adContainer.classList.remove('hidden');
        dom.adContainer.classList.add('fade-in');
        dom.transitionOverlay.classList.remove('active');

        dom.statusDot.classList.add('ad');
        dom.statusLabel.textContent = 'ANÚNCIO';

        const playPromise = dom.adVideo.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            dom.adVideo.muted = true;
            dom.adVideo.play().catch(() => {});
          });
        }

        const duration = ad.duration || 15;
        adElapsed = 0;
        dom.adProgressBar.style.width = '0%';
        dom.adCountdown.textContent   = duration + 's';

        adCountdownTimer = setInterval(() => {
          adElapsed++;
          const pct = Math.min((adElapsed / duration) * 100, 100);
          dom.adProgressBar.style.width = pct + '%';
          dom.adCountdown.textContent   = Math.max(0, duration - adElapsed) + 's';
        }, 1000);

        if (config?.schedule?.showSkipBtn) {
          skipTimeout = setTimeout(() => dom.skipBtn.classList.remove('hidden'), 5000);
        }

        const endTimeout = setTimeout(() => endAd(resolve), duration * 1000);
        dom.adVideo.onended = () => { clearTimeout(endTimeout); endAd(resolve); };
        dom.adVideo.onerror = () => { clearTimeout(endTimeout); endAd(resolve); };

      }, 300);
    });
  }

  function endAd(resolve) {
    if (!isPlayingAd) return;
    clearInterval(adCountdownTimer);
    clearTimeout(skipTimeout);

    dom.adContainer.classList.remove('fade-in');
    dom.adContainer.classList.add('fade-out');
    dom.transitionOverlay.classList.add('active');

    setTimeout(() => {
      dom.adVideo.pause();
      dom.adVideo.src = '';
      dom.adContainer.classList.add('hidden');
      dom.adContainer.classList.remove('fade-out');
      dom.adProgressBar.style.width = '0%';
      dom.skipBtn.classList.add('hidden');

      exitPip();
      dom.statusDot.classList.remove('ad');
      dom.statusLabel.textContent = 'AO VIVO';
      isPlayingAd = false;

      setTimeout(() => {
        dom.transitionOverlay.classList.remove('active');
        resumeYouTube();
      }, 200);

      if (resolve) resolve();
    }, 400);
  }

  function skipAd() {
    if (!isPlayingAd) return;
    endAd(null);
    setTimeout(scheduleNextAd, 600);
  }

  /* ═══════════════════════════════════════════
     PIP
  ═══════════════════════════════════════════ */
  function enterPip() {
    const pos = config?.ui?.pipPosition || 'bottom-right';
    dom.ytWrapper.classList.add('pip');
    ['pip-bottom-left','pip-top-right','pip-top-left'].forEach(c =>
      dom.ytWrapper.classList.remove(c));
    if (pos !== 'bottom-right') dom.ytWrapper.classList.add('pip-' + pos);
  }

  function exitPip() {
    dom.ytWrapper.classList.remove('pip');
    ['pip-bottom-left','pip-top-right','pip-top-left'].forEach(c =>
      dom.ytWrapper.classList.remove(c));
  }

  /* ═══════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════ */
  function showToast(msg, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3000);
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  return {
    init, skipAd,
    forceAd: () => { clearSchedule(); triggerAdSequence(); },
    resetTimer: scheduleNextAd,
  };
})();

document.addEventListener('DOMContentLoaded', () => SignagePlayer.init());
