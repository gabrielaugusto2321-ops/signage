/**
 * SignageOS — Player Core (app.js) — v2 Safari/iPad Fix
 *
 * Correções:
 *  - Safari iPad: tela de toque para desbloquear autoplay
 *  - YouTube não trava após retornar do PiP
 *  - Viewport horizontal corrigido
 *  - Anúncios de demo com URLs mais confiáveis
 */

const SignagePlayer = (() => {
  let ytPlayer         = null;
  let ytReady          = false;
  let scheduleTimer    = null;
  let adQueue          = [];
  let adQueueIndex     = 0;
  let isPlayingAd      = false;
  let adCountdownTimer = null;
  let skipTimeout      = null;
  let adElapsed        = 0;
  let config           = null;
  let userInteracted   = false; // Safari requer interação

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

    config = Storage.getConfig();
    applyConfig();
    startClock();
    buildAdQueue();
    listenForAdminUpdates();
    setupTapToStart(); // Safari fix

    console.log('[SignageOS] v2 initialized');
  }

  /* ═══════════════════════════════════════════
     SAFARI — TAP TO START
     Safari bloqueia autoplay sem interação do usuário.
     Mostramos uma tela de toque antes de iniciar.
  ═══════════════════════════════════════════ */
  function setupTapToStart() {
    const overlay = dom.tapOverlay;
    if (!overlay) return;

    // Detecta se é Safari/iOS
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
      || /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isSafari) {
      overlay.classList.remove('hidden');
      overlay.addEventListener('click', () => {
        userInteracted = true;
        overlay.classList.add('hidden');
        startYouTube();
      }, { once: true });
    } else {
      userInteracted = true;
      startYouTube();
    }
  }

  function startYouTube() {
    // Carrega a API do YouTube dinamicamente após interação
    if (typeof YT !== 'undefined' && YT.Player) {
      window.onYouTubeIframeAPIReady();
    }
    // caso a API ainda não tenha carregado, o callback onYouTubeIframeAPIReady
    // será chamado automaticamente quando ela terminar de carregar
  }

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  function applyConfig() {
    if (!config.ui.showStatusBar) {
      dom.statusBar && dom.statusBar.classList.add('hide');
    }
  }

  function reloadConfig() {
    config = Storage.getConfig();
    applyConfig();
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
     YOUTUBE API
  ═══════════════════════════════════════════ */
  window.onYouTubeIframeAPIReady = function () {
    // Se Safari ainda não teve interação, aguarda
    if (!userInteracted) return;

    const yt = config.youtube;
    const videoId = yt.videoId || 'q8LE5H0UJz8';

    ytPlayer = new YT.Player('ytPlayer', {
      videoId,
      playerVars: {
        autoplay:       1,
        mute:           1,           // sempre mudo para garantir autoplay
        controls:       0,
        disablekb:      1,
        fs:             0,
        iv_load_policy: 3,
        loop:           1,
        playlist:       videoId,     // obrigatório para loop
        rel:            0,
        modestbranding: 1,
        start:          yt.startAt || 0,
        playsinline:    1,           // obrigatório no iOS
        enablejsapi:    1,
        origin:         window.location.origin,
      },
      events: {
        onReady:       onYTReady,
        onStateChange: onYTStateChange,
        onError:       onYTError,
      },
    });
  };

  function onYTReady(e) {
    ytReady = true;
    e.target.playVideo();
    console.log('[SignageOS] YouTube ready');
    scheduleNextAd();
    showToast('Player iniciado ✓');
  }

  function onYTStateChange(e) {
    // Reinicia se parar (loop manual como fallback)
    if (e.data === YT.PlayerState.ENDED || e.data === YT.PlayerState.PAUSED) {
      if (!isPlayingAd) {
        setTimeout(() => {
          try {
            ytPlayer.seekTo(config.youtube.startAt || 0, true);
            ytPlayer.playVideo();
          } catch(err) {}
        }, 500);
      }
    }
  }

  function onYTError(e) {
    console.warn('[SignageOS] YouTube error:', e.data);
  }

  /* ═══════════════════════════════════════════
     RETOMAR YOUTUBE APÓS ANÚNCIO
     Método robusto: destrói e recria o player
     para garantir que não trava no Safari
  ═══════════════════════════════════════════ */
  function resumeYouTube() {
    if (!ytPlayer) return;

    try {
      ytPlayer.playVideo();
    } catch (e) {
      // Se falhar, recria o player
      console.warn('[SignageOS] Recreating YT player after ad');
      ytReady = false;
      ytPlayer.destroy();
      ytPlayer = null;

      // Limpa o container e recria
      const container = $('ytPlayer');
      if (container) {
        container.innerHTML = '';
        container.id = 'ytPlayer'; // mantém o ID
      }

      // Pequeno delay antes de recriar
      setTimeout(() => {
        window.onYouTubeIframeAPIReady();
      }, 300);
    }
  }

  /* ═══════════════════════════════════════════
     TROCA DE VÍDEO
  ═══════════════════════════════════════════ */
  function changeYouTubeVideo(videoId) {
    if (!ytReady || !ytPlayer) return;
    try {
      ytPlayer.loadVideoById({ videoId, startSeconds: 0 });
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════
     AD QUEUE
  ═══════════════════════════════════════════ */
  function buildAdQueue() {
    const activeAds = Storage.getActiveAds();
    if (!activeAds.length) { adQueue = []; return; }

    const rotation = config.schedule.rotation;
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
      if (config.schedule.rotation === 'random') adQueue = shuffle(adQueue);
    }
    return ad;
  }

  /* ═══════════════════════════════════════════
     SCHEDULING
  ═══════════════════════════════════════════ */
  let nextAdAt = null;
  let _scheduleInterval = null;
  let _scheduleTimeout  = null;

  function scheduleNextAd() {
    clearSchedule();
    const intervalMs = (config.schedule.intervalMinutes || 2) * 60 * 1000;
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
    buildAdQueue();
    const maxSeq = config.schedule.maxSequential || 1;

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

      reloadConfig();

      // Pausa YouTube durante o anúncio
      try { if (ytPlayer) ytPlayer.pauseVideo(); } catch(e) {}

      // Transição entrada
      dom.transitionOverlay.classList.add('active');

      setTimeout(() => {
        enterPip();

        // Configura vídeo
        dom.adVideo.muted    = false;
        dom.adVideo.src      = ad.url;
        dom.adVideo.load();

        if (dom.adTitle) dom.adTitle.textContent = ad.name;

        dom.adContainer.classList.remove('hidden');
        dom.adContainer.classList.add('fade-in');

        dom.transitionOverlay.classList.remove('active');

        dom.statusDot.classList.add('ad');
        dom.statusLabel.textContent = 'ANÚNCIO';

        // Toca anúncio — fallback muted para Safari
        const playPromise = dom.adVideo.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            dom.adVideo.muted = true;
            dom.adVideo.play().catch(() => {});
          });
        }

        // Progress + countdown
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

        // Skip
        if (config.schedule.showSkipBtn) {
          skipTimeout = setTimeout(() => {
            dom.skipBtn.classList.remove('hidden');
          }, 5000);
        }

        // Fim do anúncio
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

      // Retoma YouTube — método robusto
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
    const pos = (config.ui && config.ui.pipPosition) || 'bottom-right';
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
     SYNC
  ═══════════════════════════════════════════ */
  function listenForAdminUpdates() {
    Storage.onMessage(msg => {
      switch (msg.type) {
        case 'CONFIG_UPDATED':
          reloadConfig();
          if (!isPlayingAd) scheduleNextAd();
          break;
        case 'ADS_UPDATED':
          buildAdQueue();
          break;
        case 'FORCE_AD':
          clearSchedule();
          triggerAdSequence();
          break;
        case 'RESET_TIMER':
          if (!isPlayingAd) scheduleNextAd();
          break;
        case 'CHANGE_YT':
          if (msg.payload && msg.payload.videoId) changeYouTubeVideo(msg.payload.videoId);
          break;
      }
    });
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

  return { init, skipAd,
    forceAd: () => { clearSchedule(); triggerAdSequence(); },
    resetTimer: scheduleNextAd,
    changeYouTubeVideo,
  };
})();

document.addEventListener('DOMContentLoaded', () => SignagePlayer.init());
