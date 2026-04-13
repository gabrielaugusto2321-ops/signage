/**
 * SignageOS — Storage Layer
 * Simulates Firebase Firestore using localStorage.
 * Structure mirrors a real Firestore schema for easy migration.
 *
 * Collections:
 *   signage_ads    → video_ads[]
 *   signage_config → system configuration
 */

const Storage = (() => {
  const KEYS = {
    ADS:    'signage_ads',
    CONFIG: 'signage_config',
  };

  /* ─────────────────────────────────────────────
     DEFAULT DATA
  ───────────────────────────────────────────── */
  const DEFAULT_CONFIG = {
    youtube: {
      videoId:   'jfKfPfyJRdk',   // lofi hip hop — Radio for Relaxing
      startAt:   0,
      muted:     true,
      loop:      true,
    },
    schedule: {
      intervalMinutes: 2,
      maxSequential:   1,
      rotation:        'sequential', // sequential | priority | random
      showSkipBtn:     true,
    },
    ui: {
      pipPosition:  'bottom-right',  // bottom-right | bottom-left | top-right | top-left
      showStatusBar: true,
      transitions:   true,
    },
  };

  const DEFAULT_ADS = [
    {
      id:       'ad_demo_001',
      name:     'Demonstração — Big Buck Bunny',
      url:      'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      duration: 20,
      priority: 3,
      active:   true,
      tags:     ['demo'],
      createdAt: Date.now(),
    },
    {
      id:       'ad_demo_002',
      name:     'Demonstração — For Bigger Blazes',
      url:      'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      duration: 15,
      priority: 2,
      active:   true,
      tags:     ['demo'],
      createdAt: Date.now(),
    },
    {
      id:       'ad_demo_003',
      name:     'Demonstração — Subaru (inativo)',
      url:      'https://storage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
      duration: 15,
      priority: 1,
      active:   false,
      tags:     ['demo'],
      createdAt: Date.now(),
    },
  ];

  /* ─────────────────────────────────────────────
     INTERNALS
  ───────────────────────────────────────────── */
  function _read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function _write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Storage] write error:', e);
      return false;
    }
  }

  function _seed() {
    if (!_read(KEYS.CONFIG)) _write(KEYS.CONFIG, DEFAULT_CONFIG);
    if (!_read(KEYS.ADS))    _write(KEYS.ADS, DEFAULT_ADS);
  }

  /* ─────────────────────────────────────────────
     PUBLIC API — CONFIG
  ───────────────────────────────────────────── */
  function getConfig() {
    _seed();
    return _read(KEYS.CONFIG);
  }

  function saveConfig(config) {
    return _write(KEYS.CONFIG, config);
  }

  function updateConfig(partial) {
    const current = getConfig();
    const merged  = deepMerge(current, partial);
    return _write(KEYS.CONFIG, merged);
  }

  /* ─────────────────────────────────────────────
     PUBLIC API — ADS
  ───────────────────────────────────────────── */
  function getAds() {
    _seed();
    return _read(KEYS.ADS) || [];
  }

  function getActiveAds() {
    return getAds().filter(a => a.active);
  }

  function getAdById(id) {
    return getAds().find(a => a.id === id) || null;
  }

  function saveAd(ad) {
    const ads = getAds();
    if (!ad.id) ad.id = 'ad_' + Date.now();
    if (!ad.createdAt) ad.createdAt = Date.now();
    const idx = ads.findIndex(a => a.id === ad.id);
    if (idx >= 0) ads[idx] = ad;
    else ads.push(ad);
    return _write(KEYS.ADS, ads);
  }

  function deleteAd(id) {
    const ads = getAds().filter(a => a.id !== id);
    return _write(KEYS.ADS, ads);
  }

  function toggleAd(id) {
    const ads = getAds();
    const ad  = ads.find(a => a.id === id);
    if (ad) {
      ad.active = !ad.active;
      _write(KEYS.ADS, ads);
      return ad.active;
    }
    return null;
  }

  /* ─────────────────────────────────────────────
     UTILS
  ───────────────────────────────────────────── */
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

  function exportAll() {
    return JSON.stringify({
      ads:    getAds(),
      config: getConfig(),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  function importAll(data) {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsed.ads)    _write(KEYS.ADS, parsed.ads);
      if (parsed.config) _write(KEYS.CONFIG, parsed.config);
      return true;
    } catch {
      return false;
    }
  }

  function resetAll() {
    localStorage.removeItem(KEYS.ADS);
    localStorage.removeItem(KEYS.CONFIG);
    _seed();
  }

  /* ─────────────────────────────────────────────
     CROSS-TAB SYNC (BroadcastChannel)
     Admin → Player sync sem reload
  ───────────────────────────────────────────── */
  const _channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('signage_sync')
    : null;

  function broadcast(type, payload = {}) {
    if (_channel) _channel.postMessage({ type, payload, ts: Date.now() });
  }

  function onMessage(cb) {
    if (_channel) _channel.onmessage = e => cb(e.data);
  }




  /* INIT — reset cache if version changed */
  const _VER = "v3";
  if (localStorage.getItem("signage_version") !== _VER) {
    localStorage.removeItem("signage_ads");
    localStorage.removeItem("signage_config");
    localStorage.setItem("signage_version", _VER);
  }
  _seed();


  return {
    getConfig, saveConfig, updateConfig,
    getAds, getActiveAds, getAdById,
    saveAd, deleteAd, toggleAd,
    exportAll, importAll, resetAll,
    broadcast, onMessage,
    DEFAULT_CONFIG,
  };
})();
