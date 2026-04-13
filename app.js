/**
 * SignageOS — Player Core (app.js)
 *
 * Responsabilidades:
 *  - Inicializar o YouTube IFrame Player
 *  - Gerenciar o loop de agendamento de anúncios
 *  - Controlar transições YouTube ↔ anúncio (PiP)
 *  - Sincronizar configurações em tempo real via BroadcastChannel
 */

const SignagePlayer = (() => {
  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */
  let ytPlayer        = null;
  let ytReady         = false;
  let scheduleTimer   = null;
  let adQueue         = [];
  let adQueueIndex    = 0;
  let isPlayingAd     = false;
  let adCountdownTimer = null;
  let skipTimeout     = null;
  let adElapsed       = 0;
  let config          = null;

  /* ═══════════════════════════════════════════
     DOM REFS
  ═══════════════════════════════════════════ */
  const $ = id => document.getElementById(id);

  const dom = {
    ytWrapper:         null,
    adContainer:       null,
    adVideo:           null,
    adProgressBar:     null,
    adCountdown:       null,
    adTitle:           null,
    skipBtn:           null,
    transitionOverlay: null,
    statusDot:         null,
    statusLabel:       null,
    nextAdTimer:       null,
    statusBar:         null,
    clockDisplay:      null,
  };

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    Object.keys(dom).forEach(k => { dom[k] = $(k === 'ytWrapper' ? 'ytWrapper'
      : k.replace(/([A-Z])/g, m => m[0].toUpperCase())); });

    // map dom refs properly
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

    config = Storage.getConfig();
    applyConfig();
    startClock();
    buildAdQueue();
    listenForAdminUpdates();

    // Adicionado log de debug para TV Box
    console.log('[SignageOS] Player initialized', { config });
  }

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  function applyConfig() {
    // status bar visibility
    if (!config.ui.showStatusBar) {
      dom.statusBar.classList.add('hide');
    }

    // pip position class (para CSS)
    dom.ytWrapper.dataset.pip = config.ui.pipPosition;
  }

  function reloadConfig() {
    config = Storage.getConfig();
    applyConfig();
  }

  /* ═══════════════════════════════════════════
     CLOCK
  ═══════════════════════════════════════════ */
  function startClock() {
    function tick() {
      const now = new Date();
      dom.clockDisplay.textContent = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════
     YOUTUBE — API CALLBACK (global)
  ═══════════════════════════════════════════ */
  // Exposto globalmente para o script da API do YouTube
  window.onYouTubeIframeAPIReady = function () {
    const yt = config.youtube;

    ytPlayer = new YT.Player('ytPlayer', {
      videoId:    yt.videoId || 'jfKfPfyJRdk',
      playerVars: {
        autoplay:       1,
        mute:           yt.muted ? 1 : 0,
        controls:       0,
        disablekb:      1,
        fs:             0,
        iv_load_policy: 3,
        loop:           yt.loop ? 1 : 0,
        playlist:       yt.videoId || 'jfKfPfyJRdk', // required for loop
        rel:            0,
        showinfo:       0,
        modestbranding: 1,
        start:          yt.startAt || 0,
        playsinline:    1,
        enablejsapi:    1,
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
    console.log('[SignageOS] YouTube player ready');
    scheduleNextAd();
    showToast('Player iniciado');
  }

  function onYTStateChange(e) {
    // Se o vídeo terminar e loop estiver ativo, reinicia
    if (e.data === YT.PlayerState.ENDED && config.youtube.loop) {
      ytPlayer.seekTo(config.youtube.startAt || 0);
      ytPlayer.playVideo();
    }
  }

  function onYTError(e) {
    console.warn('[SignageOS] YouTube error:', e.data);
    showToast('Erro no YouTube: ' + e.data, 'error');
  }

  /* ═══════════════════════════════════════════
     CHANGE YOUTUBE VIDEO
  ═══════════════════════════════════════════ */
  function changeYouTubeVideo(videoId) {
    if (!ytReady || !ytPlayer) return;
    const cfg = Storage.getConfig();
    ytPlayer.loadVideoById({
      videoId: videoId,
      startSeconds: cfg.youtube.startAt || 0,
    });
    if (cfg.youtube.muted) ytPlayer.mute();
    console.log('[SignageOS] YouTube changed to:', videoId);
  }

  /* ═══════════════════════════════════════════
     AD QUEUE
  ═══════════════════════════════════════════ */
  function buildAdQueue() {
    const activeAds = Storage.getActiveAds();
    if (!activeAds.length) {
      adQueue = [];
      console.log('[SignageOS] No active ads.');
      return;
    }

    const rotation = config.schedule.rotation;

    if (rotation === 'priority') {
      adQueue = [...activeAds].sort((a, b) => b.priority - a.priority);
    } else if (rotation === 'random') {
      adQueue = shuffle([...activeAds]);
    } else {
      adQueue = [...activeAds]; // sequential
    }

    adQueueIndex = 0;
    console.log('[SignageOS] Ad queue built:', adQueue.map(a => a.name));
  }

  function getNextAd() {
    if (!adQueue.length) return null;
    const ad = adQueue[adQueueIndex % adQueue.length];
    adQueueIndex++;

    // rebuild queue ao completar ciclo (random re-shuffles)
    if (adQueueIndex >= adQueue.length) {
      adQueueIndex = 0;
      if (config.schedule.rotation === 'random') {
        adQueue = shuffle(adQueue);
      }
    }
    return ad;
  }

  /* ═══════════════════════════════════════════
     SCHEDULING
  ═══════════════════════════════════════════ */
  let nextAdAt = null; // timestamp ms

  function scheduleNextAd() {
    clearSchedule();
    const intervalMs = (config.schedule.intervalMinutes || 2) * 60 * 1000;
    nextAdAt = Date.now() + intervalMs;
    updateCountdownDisplay();

    scheduleTimer = setInterval(() => {
      updateCountdownDisplay();
    }, 1000);

    scheduleTimer._timeout = setTimeout(() => {
      clearInterval(scheduleTimer);
      triggerAdSequence();
    }, intervalMs);

    // unifica: guarda o timeout no timer object
    const _int = scheduleTimer;
    scheduleTimer = {
      interval: _int,
      timeout:  scheduleTimer._timeout,
    };
  }

  function clearSchedule() {
    if (!scheduleTimer) return;
    if (scheduleTimer.interval) clearInterval(scheduleTimer.interval);
    if (scheduleTimer.timeout)  clearTimeout(scheduleTimer.timeout);
    scheduleTimer = null;
    if (dom.nextAdTimer) dom.nextAdTimer.textContent = '';
  }

  function updateCountdownDisplay() {
    if (!nextAdAt || !dom.nextAdTimer) return;
    const remaining = Math.max(0, Math.round((nextAdAt - Date.now()) / 1000));
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    dom.nextAdTimer.textContent = `PRÓX ${m}:${String(s).padStart(2, '0')}`;
  }

  /* ═══════════════════════════════════════════
     AD SEQUENCE
  ═══════════════════════════════════════════ */
  async function triggerAdSequence() {
    const maxSeq = config.schedule.maxSequential || 1;
    buildAdQueue(); // refresh queue antes de exibir

    for (let i = 0; i < maxSeq; i++) {
      const ad = getNextAd();
      if (!ad) break;
      await playAd(ad);
      // pequena pausa entre anúncios sequenciais
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

      console.log('[SignageOS] Playing ad:', ad.name);
      reloadConfig(); // garantir config atualizada

      // 1. Fade in overlay de transição
      if (config.ui.transitions) {
        dom.transitionOverlay.classList.add('active');
      }

      setTimeout(() => {
        // 2. Ativa PiP do YouTube
        enterPip();

        // 3. Prepara vídeo do anúncio
        dom.adVideo.src = ad.url;
        dom.adVideo.load();

        if (dom.adTitle) dom.adTitle.textContent = ad.name;

        // 4. Mostra container
        dom.adContainer.classList.remove('hidden');
        dom.adContainer.classList.add('fade-in');

        // 5. Fade out overlay
        if (config.ui.transitions) {
          dom.transitionOverlay.classList.remove('active');
        }

        // 6. Atualiza status bar
        dom.statusDot.classList.add('ad');
        dom.statusLabel.textContent = 'ANÚNCIO';

        // 7. Toca vídeo
        dom.adVideo.play().catch(err => {
          console.warn('[SignageOS] Ad autoplay blocked:', err);
          // Tentar muted como fallback
          dom.adVideo.muted = true;
          dom.adVideo.play().catch(() => {});
        });

        // 8. Progress bar + countdown
        const duration = ad.duration || 15;
        adElapsed = 0;
        dom.adProgressBar.style.width = '0%';
        dom.adCountdown.textContent = duration + 's';

        adCountdownTimer = setInterval(() => {
          adElapsed++;
          const pct = Math.min((adElapsed / duration) * 100, 100);
          dom.adProgressBar.style.width = pct + '%';
          dom.adCountdown.textContent = Math.max(0, duration - adElapsed) + 's';
        }, 1000);

        // 9. Skip button
        if (config.schedule.showSkipBtn) {
          skipTimeout = setTimeout(() => {
            dom.skipBtn.classList.remove('hidden');
          }, 5000);
        }

        // 10. Auto-terminar após duration
        const endTimeout = setTimeout(() => {
          endAd(resolve);
        }, duration * 1000);

        // 11. Terminar se vídeo acabar antes
        dom.adVideo.onended = () => {
          clearTimeout(endTimeout);
          endAd(resolve);
        };

        dom.adVideo.onerror = () => {
          console.warn('[SignageOS] Ad video error, skipping');
          clearTimeout(endTimeout);
          endAd(resolve);
        };

      }, config.ui.transitions ? 300 : 0);
    });
  }

  function endAd(resolve) {
    if (!isPlayingAd) return;

    clearInterval(adCountdownTimer);
    clearTimeout(skipTimeout);

    // Fade out anúncio
    dom.adContainer.classList.remove('fade-in');
    dom.adContainer.classList.add('fade-out');

    // Overlay de transição
    if (config.ui.transitions) {
      dom.transitionOverlay.classList.add('active');
    }

    setTimeout(() => {
      // Limpar
      dom.adVideo.pause();
      dom.adVideo.src = '';
      dom.adContainer.classList.add('hidden');
      dom.adContainer.classList.remove('fade-out');
      dom.adProgressBar.style.width = '0%';
      dom.skipBtn.classList.add('hidden');

      // Sair do PiP
      exitPip();

      // Status bar
      dom.statusDot.classList.remove('ad');
      dom.statusLabel.textContent = 'AO VIVO';

      isPlayingAd = false;

      // Remove overlay
      if (config.ui.transitions) {
        setTimeout(() => {
          dom.transitionOverlay.classList.remove('active');
        }, 200);
      }

      if (resolve) resolve();
    }, 400);
  }

  function skipAd() {
    if (!isPlayingAd) return;
    endAd(null);
    // Reagendar
    setTimeout(scheduleNextAd, 500);
  }

  /* ═══════════════════════════════════════════
     PIP CONTROL
  ═══════════════════════════════════════════ */
  function enterPip() {
    const pos = config.ui.pipPosition || 'bottom-right';
    dom.ytWrapper.classList.add('pip');

    // Remove posições anteriores
    ['pip-bottom-left', 'pip-top-right', 'pip-top-left'].forEach(c =>
      dom.ytWrapper.classList.remove(c)
    );

    if (pos !== 'bottom-right') {
      dom.ytWrapper.classList.add('pip-' + pos);
    }
  }

  function exitPip() {
    dom.ytWrapper.classList.remove('pip');
    ['pip-bottom-left', 'pip-top-right', 'pip-top-left'].forEach(c =>
      dom.ytWrapper.classList.remove(c)
    );
  }

  /* ═══════════════════════════════════════════
     REAL-TIME SYNC (BroadcastChannel)
  ═══════════════════════════════════════════ */
  function listenForAdminUpdates() {
    Storage.onMessage(msg => {
      console.log('[SignageOS] Sync message:', msg.type);

      switch (msg.type) {
        case 'CONFIG_UPDATED':
          reloadConfig();
          // Reiniciar agendamento se intervalo mudou
          if (!isPlayingAd) scheduleNextAd();
          showToast('Configurações atualizadas');
          break;

        case 'ADS_UPDATED':
          buildAdQueue();
          showToast('Lista de anúncios atualizada');
          break;

        case 'FORCE_AD':
          clearSchedule();
          triggerAdSequence();
          break;

        case 'RESET_TIMER':
          if (!isPlayingAd) scheduleNextAd();
          showToast('Timer reiniciado');
          break;

        case 'CHANGE_YT':
          if (msg.payload && msg.payload.videoId) {
            changeYouTubeVideo(msg.payload.videoId);
            showToast('YouTube atualizado');
          }
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
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, 3000);
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

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /* ═══════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════ */
  return {
    init,
    skipAd,
    forceAd: () => {
      clearSchedule();
      triggerAdSequence();
    },
    resetTimer: scheduleNextAd,
    changeYouTubeVideo,
  };
})();

/* ─────────────────────────────────────────────
   BOOT
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  SignagePlayer.init();
});
