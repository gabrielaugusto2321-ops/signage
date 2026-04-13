/**
 * SignageOS — Player v6
 * Usa iframe direto sem YouTube API — resolve autoplay em qualquer navegador
 */

const SignagePlayer = (() => {
  let isPlayingAd      = false;
  let adQueue          = [];
  let adQueueIndex     = 0;
  let adCountdownTimer = null;
  let skipTimeout      = null;
  let adElapsed        = 0;
  let config           = null;
  let _scheduleInterval = null;
  let _scheduleTimeout  = null;
  let nextAdAt          = null;

  const $ = id => document.getElementById(id);
  const dom = {};

  /* ═══════════════════════════════════════
     INIT
  ═══════════════════════════════════════ */
  function init() {
    dom.ytWrapper         = $('ytWrapper');
    dom.ytFrame           = $('ytFrame');
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

    exitPip();
    dom.adContainer.classList.add('hidden');
    isPlayingAd = false;

    startClock();

    // Botão de toque — aparece imediatamente
    dom.tapOverlay.addEventListener('click', onTap, { once: true });
    dom.tapOverlay.addEventListener('touchend', onTap, { once: true });

    // Firebase em background
    Storage.onReady(async () => {
      config = await Storage.getConfig();
      buildAdQueue();
      startRealtimeListeners();
    });
  }

  /* ═══════════════════════════════════════
     TAP — inicia tudo
  ═══════════════════════════════════════ */
  async function onTap() {
    // Esconde overlay
    dom.tapOverlay.style.transition = 'opacity 0.4s ease';
    dom.tapOverlay.style.opacity = '0';
    setTimeout(() => dom.tapOverlay.classList.add('hidden'), 400);

    // Garante config
    if (!config) config = Storage.DEFAULT_CONFIG;

    // Carrega YouTube via iframe direto
    loadYouTubeIframe();
  }

  /* ═══════════════════════════════════════
     YOUTUBE — iframe direto (sem API)
     Autoplay funciona em qualquer browser
  ═══════════════════════════════════════ */
  function loadYouTubeIframe(videoId) {
    const yt         = config?.youtube || {};
    const vid        = videoId || yt.videoId || 'q8LE5H0UJz8';
    const playlistId = yt.playlistId || '';

    let src = '';

    if (playlistId) {
      src = `https://www.youtube.com/embed/videoseries?list=${playlistId}&autoplay=1&mute=1&controls=0&loop=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=0`;
    } else {
      src = `https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&controls=0&loop=1&playlist=${vid}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=0&start=${yt.startAt||0}`;
    }

    dom.ytFrame.src = src;
    console.log('[SignageOS] YouTube iframe loaded:', src);

    // Inicia agendamento após carregar
    dom.ytFrame.onload = () => {
      scheduleNextAd();
    };
  }

  /* ═══════════════════════════════════════
     REALTIME LISTENERS
  ═══════════════════════════════════════ */
  function startRealtimeListeners() {
    Storage.listenConfig(newConfig => {
      const oldVid      = config?.youtube?.videoId;
      const oldPlaylist = config?.youtube?.playlistId;
      config = newConfig;

      // Atualiza YouTube se mudou
      if (newConfig.youtube.videoId !== oldVid ||
          newConfig.youtube.playlistId !== oldPlaylist) {
        if (!dom.tapOverlay || dom.tapOverlay.classList.contains('hidden')) {
          loadYouTubeIframe();
        }
      }
      if (!isPlayingAd) scheduleNextAd();
    });

    Storage.listenAds(ads => buildAdQueueFromList(ads));

    Storage.onMessage(msg => {
      if (msg.type === 'FORCE_AD') { clearSchedule(); triggerAdSequence(); }
      if (msg.type === 'RESET_TIMER' && !isPlayingAd) scheduleNextAd();
    });
  }

  /* ═══════════════════════════════════════
     CLOCK
  ═══════════════════════════════════════ */
  function startClock() {
    const tick = () => {
      if (dom.clockDisplay)
        dom.clockDisplay.textContent = new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════
     AD QUEUE
  ═══════════════════════════════════════ */
  async function buildAdQueue() {
    const ads = await Storage.getActiveAds();
    buildAdQueueFromList(ads);
  }

  function buildAdQueueFromList(allAds) {
    const active   = allAds.filter(a => a.active);
    if (!active.length) { adQueue = []; return; }
    const rotation = config?.schedule?.rotation || 'sequential';
    if (rotation === 'priority') adQueue = [...active].sort((a,b) => b.priority - a.priority);
    else if (rotation === 'random') adQueue = shuffle([...active]);
    else adQueue = [...active];
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

  /* ═══════════════════════════════════════
     SCHEDULING
  ═══════════════════════════════════════ */
  function scheduleNextAd() {
    clearSchedule();
    const intervalMs = (config?.schedule?.intervalMinutes || 2) * 60 * 1000;
    nextAdAt = Date.now() + intervalMs;
    _scheduleInterval = setInterval(updateCountdown, 1000);
    _scheduleTimeout  = setTimeout(() => { clearInterval(_scheduleInterval); triggerAdSequence(); }, intervalMs);
    updateCountdown();
  }

  function clearSchedule() {
    clearInterval(_scheduleInterval);
    clearTimeout(_scheduleTimeout);
    if (dom.nextAdTimer) dom.nextAdTimer.textContent = '';
  }

  function updateCountdown() {
    if (!nextAdAt || !dom.nextAdTimer) return;
    const rem = Math.max(0, Math.round((nextAdAt - Date.now()) / 1000));
    dom.nextAdTimer.textContent = `PRÓX ${Math.floor(rem/60)}:${String(rem%60).padStart(2,'0')}`;
  }

  /* ═══════════════════════════════════════
     AD SEQUENCE
  ═══════════════════════════════════════ */
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

  /* ═══════════════════════════════════════
     PLAY AD
  ═══════════════════════════════════════ */
  function playAd(ad) {
    return new Promise(resolve => {
      if (isPlayingAd) { resolve(); return; }
      isPlayingAd = true;

      dom.transitionOverlay.classList.add('active');

      setTimeout(() => {
        enterPip();

        dom.adVideo.src   = ad.url;
        dom.adVideo.muted = false;
        dom.adVideo.load();

        if (dom.adTitle) dom.adTitle.textContent = ad.name;
        dom.adContainer.classList.remove('hidden');
        dom.adContainer.classList.add('fade-in');
        dom.transitionOverlay.classList.remove('active');

        dom.statusDot.classList.add('ad');
        dom.statusLabel.textContent = 'ANÚNCIO';

        dom.adVideo.play().catch(() => { dom.adVideo.muted = true; dom.adVideo.play().catch(()=>{}); });

        const duration = ad.duration || 15;
        adElapsed = 0;
        dom.adProgressBar.style.width = '0%';
        dom.adCountdown.textContent   = duration + 's';

        adCountdownTimer = setInterval(() => {
          adElapsed++;
          dom.adProgressBar.style.width = Math.min((adElapsed/duration)*100, 100) + '%';
          dom.adCountdown.textContent   = Math.max(0, duration - adElapsed) + 's';
        }, 1000);

        if (config?.schedule?.showSkipBtn !== false) {
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

      setTimeout(() => dom.transitionOverlay.classList.remove('active'), 200);
      if (resolve) resolve();
    }, 400);
  }

  function skipAd() {
    if (!isPlayingAd) return;
    endAd(null);
    setTimeout(scheduleNextAd, 600);
  }

  /* ═══════════════════════════════════════
     PIP
  ═══════════════════════════════════════ */
  function enterPip() {
    const pos = config?.ui?.pipPosition || 'bottom-right';
    dom.ytWrapper.classList.add('pip');
    ['pip-bottom-left','pip-top-right','pip-top-left'].forEach(c => dom.ytWrapper.classList.remove(c));
    if (pos !== 'bottom-right') dom.ytWrapper.classList.add('pip-' + pos);
  }

  function exitPip() {
    dom.ytWrapper.classList.remove('pip');
    ['pip-bottom-left','pip-top-right','pip-top-left'].forEach(c => dom.ytWrapper.classList.remove(c));
  }

  /* ═══════════════════════════════════════
     UTILS
  ═══════════════════════════════════════ */
  function showToast(msg, type='info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('toastContainer')?.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3000);
  }

  function shuffle(arr) {
    for (let i = arr.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  document.addEventListener('DOMContentLoaded', init);

  return { init, skipAd,
    forceAd: () => { clearSchedule(); triggerAdSequence(); },
    resetTimer: scheduleNextAd,
  };
})();
