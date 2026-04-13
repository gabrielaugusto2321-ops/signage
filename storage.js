/**
 * SignageOS — Storage Layer v4 (Firebase)
 * Sincroniza automaticamente entre PC, TV Box e qualquer dispositivo.
 */

// ═══════════════════════════════════════════
// FIREBASE CONFIG — suas credenciais
// ═══════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBdmocl7jzC9gSFGkymWcTbXvELyj_ZQTM",
  authDomain:        "signageos-a4dbb.firebaseapp.com",
  projectId:         "signageos-a4dbb",
  storageBucket:     "signageos-a4dbb.firebasestorage.app",
  messagingSenderId: "375736086785",
  appId:             "1:375736086785:web:ec2a7deb21046b7b98ab00"
};

const Storage = (() => {

  // ─── Firebase refs ───
  let _db       = null;
  let _ready    = false;
  let _onReadyCbs = [];

  // ─── Listeners registrados ───
  let _adsListener    = null;
  let _configListener = null;

  // ─── Cache local (evita leituras desnecessárias) ───
  let _adsCache    = null;
  let _configCache = null;

  // ─── BroadcastChannel (sync entre abas) ───
  const _channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('signage_sync') : null;

  /* ═══════════════════════════════════════════
     DEFAULT DATA
  ═══════════════════════════════════════════ */
  const DEFAULT_CONFIG = {
    youtube: {
      videoId:    'q8LE5H0UJz8',
      playlistId: '',
      startAt:    0,
      muted:      true,
      loop:       true,
    },
    schedule: {
      intervalMinutes: 2,
      maxSequential:   1,
      rotation:        'sequential',
      showSkipBtn:      true,
    },
    ui: {
      pipPosition:   'bottom-right',
      showStatusBar:  true,
      transitions:    true,
    },
  };

  const DEFAULT_ADS = [
    {
      id:        'ad_demo_001',
      name:      'Demonstração — Big Buck Bunny',
      url:       'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration:  20,
      priority:  3,
      active:    true,
      tags:      ['demo'],
      createdAt: Date.now(),
    },
    {
      id:        'ad_demo_002',
      name:      'Demonstração — For Bigger Blazes',
      url:       'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      duration:  15,
      priority:  2,
      active:    true,
      tags:      ['demo'],
      createdAt: Date.now(),
    },
  ];

  /* ═══════════════════════════════════════════
     INIT FIREBASE
  ═══════════════════════════════════════════ */
  async function _init() {
    // Timeout de 8s — se Firebase não responder, usa localStorage
    const timeout = setTimeout(() => {
      if (!_ready) {
        console.warn('[Storage] Firebase timeout, using localStorage fallback');
        _initLocalFallback();
      }
    }, 8000);

    try {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, doc, collection, getDoc, getDocs,
              setDoc, deleteDoc, onSnapshot }
        = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const app = initializeApp(FIREBASE_CONFIG);
      _db = getFirestore(app);

      Storage._fs = { doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot };

      clearTimeout(timeout);
      _ready = true;
      console.log('[Storage] Firebase connected ✓');

      // Update loading message
      const msg = document.getElementById('loadingMsg');
      if (msg) msg.textContent = 'FIREBASE OK...';

      await _seedIfEmpty();

      _onReadyCbs.forEach(cb => cb());
      _onReadyCbs = [];

    } catch (err) {
      clearTimeout(timeout);
      console.error('[Storage] Firebase error:', err);
      _initLocalFallback();
    }
  }

  function onReady(cb) {
    if (_ready) cb();
    else _onReadyCbs.push(cb);
  }

  /* ═══════════════════════════════════════════
     SEED — popula dados iniciais no Firestore
  ═══════════════════════════════════════════ */
  async function _seedIfEmpty() {
    const { doc, collection, getDoc, getDocs, setDoc } = Storage._fs;

    // Config
    const cfgRef  = doc(_db, 'signage_config', 'main');
    const cfgSnap = await getDoc(cfgRef);
    if (!cfgSnap.exists()) {
      await setDoc(cfgRef, DEFAULT_CONFIG);
      console.log('[Storage] Config seeded');
    }

    // Ads
    const adsSnap = await getDocs(collection(_db, 'signage_ads'));
    if (adsSnap.empty) {
      for (const ad of DEFAULT_ADS) {
        await setDoc(doc(_db, 'signage_ads', ad.id), ad);
      }
      console.log('[Storage] Ads seeded');
    }
  }

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  async function getConfig() {
    if (!_ready) return _configCache || DEFAULT_CONFIG;
    const { doc, getDoc } = Storage._fs;
    const snap = await getDoc(doc(_db, 'signage_config', 'main'));
    _configCache = snap.exists() ? snap.data() : DEFAULT_CONFIG;
    return _configCache;
  }

  async function saveConfig(config) {
    if (!_ready) { localStorage.setItem('signage_config', JSON.stringify(config)); return; }
    const { doc, setDoc } = Storage._fs;
    await setDoc(doc(_db, 'signage_config', 'main'), config);
    _configCache = config;
  }

  async function updateConfig(partial) {
    const current = await getConfig();
    const merged  = deepMerge(current, partial);
    await saveConfig(merged);
  }

  /* ═══════════════════════════════════════════
     ADS
  ═══════════════════════════════════════════ */
  async function getAds() {
    if (!_ready) return _adsCache || DEFAULT_ADS;
    const { collection, getDocs } = Storage._fs;
    const snap = await getDocs(collection(_db, 'signage_ads'));
    _adsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return _adsCache;
  }

  async function getActiveAds() {
    const ads = await getAds();
    return ads.filter(a => a.active);
  }

  async function getAdById(id) {
    if (!_ready) return (_adsCache || []).find(a => a.id === id) || null;
    const { doc, getDoc } = Storage._fs;
    const snap = await getDoc(doc(_db, 'signage_ads', id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function saveAd(ad) {
    if (!ad.id) ad.id = 'ad_' + Date.now();
    if (!ad.createdAt) ad.createdAt = Date.now();
    if (!_ready) {
      const ads = JSON.parse(localStorage.getItem('signage_ads') || '[]');
      const idx = ads.findIndex(a => a.id === ad.id);
      if (idx >= 0) ads[idx] = ad; else ads.push(ad);
      localStorage.setItem('signage_ads', JSON.stringify(ads));
      return;
    }
    const { doc, setDoc } = Storage._fs;
    await setDoc(doc(_db, 'signage_ads', ad.id), ad);
  }

  async function deleteAd(id) {
    if (!_ready) return;
    const { doc, deleteDoc } = Storage._fs;
    await deleteDoc(doc(_db, 'signage_ads', id));
  }

  async function toggleAd(id) {
    const ad = await getAdById(id);
    if (!ad) return null;
    ad.active = !ad.active;
    await saveAd(ad);
    return ad.active;
  }

  /* ═══════════════════════════════════════════
     REALTIME LISTENERS
     Player escuta mudanças em tempo real
  ═══════════════════════════════════════════ */
  function listenAds(cb) {
    if (!_ready) { onReady(() => listenAds(cb)); return; }
    const { collection, onSnapshot } = Storage._fs;
    if (_adsListener) _adsListener(); // unsubscribe anterior
    _adsListener = onSnapshot(collection(_db, 'signage_ads'), snap => {
      const ads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _adsCache = ads;
      cb(ads);
    });
  }

  function listenConfig(cb) {
    if (!_ready) { onReady(() => listenConfig(cb)); return; }
    const { doc, onSnapshot } = Storage._fs;
    if (_configListener) _configListener();
    _configListener = onSnapshot(doc(_db, 'signage_config', 'main'), snap => {
      if (snap.exists()) {
        _configCache = snap.data();
        cb(_configCache);
      }
    });
  }

  /* ═══════════════════════════════════════════
     EXPORT / IMPORT / RESET
  ═══════════════════════════════════════════ */
  async function exportAll() {
    const ads    = await getAds();
    const config = await getConfig();
    return JSON.stringify({ ads, config, exportedAt: new Date().toISOString() }, null, 2);
  }

  async function importAll(data) {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed.config) await saveConfig(parsed.config);
      if (parsed.ads) {
        for (const ad of parsed.ads) await saveAd(ad);
      }
      return true;
    } catch { return false; }
  }

  async function resetAll() {
    const { collection, getDocs, doc, deleteDoc, setDoc } = Storage._fs;
    // Deleta todos os ads
    const snap = await getDocs(collection(_db, 'signage_ads'));
    for (const d of snap.docs) await deleteDoc(doc(_db, 'signage_ads', d.id));
    // Reseta config
    await setDoc(doc(_db, 'signage_config', 'main'), DEFAULT_CONFIG);
    // Reseed
    for (const ad of DEFAULT_ADS) {
      await setDoc(doc(_db, 'signage_ads', ad.id), ad);
    }
  }

  /* ═══════════════════════════════════════════
     BROADCAST (entre abas do mesmo browser)
  ═══════════════════════════════════════════ */
  function broadcast(type, payload = {}) {
    if (_channel) _channel.postMessage({ type, payload, ts: Date.now() });
  }

  function onMessage(cb) {
    if (_channel) _channel.onmessage = e => cb(e.data);
  }

  /* ═══════════════════════════════════════════
     FALLBACK LOCAL (se Firebase falhar)
  ═══════════════════════════════════════════ */
  function _initLocalFallback() {
    _ready = true;
    if (!localStorage.getItem('signage_config'))
      localStorage.setItem('signage_config', JSON.stringify(DEFAULT_CONFIG));
    if (!localStorage.getItem('signage_ads'))
      localStorage.setItem('signage_ads', JSON.stringify(DEFAULT_ADS));
    _onReadyCbs.forEach(cb => cb());
    _onReadyCbs = [];
    console.warn('[Storage] Using localStorage fallback');
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function deepMerge(target, source) {
    const out = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        out[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        out[key] = source[key];
      }
    }
    return out;
  }

  /* ═══════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════ */
  _init();

  return {
    onReady,
    getConfig, saveConfig, updateConfig,
    getAds, getActiveAds, getAdById,
    saveAd, deleteAd, toggleAd,
    listenAds, listenConfig,
    exportAll, importAll, resetAll,
    broadcast, onMessage,
    DEFAULT_CONFIG,
    get isReady() { return _ready; },
  };
})();
