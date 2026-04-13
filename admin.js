/**
 * SignageOS — Admin Controller v4 (Firebase)
 */

const AdminController = (() => {
  let editingAdId = null;
  let allAds      = [];

  const $ = id => document.getElementById(id);

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    setupNavigation();
    startClock();

    // Aguarda Firebase
    Storage.onReady(() => {
      loadDashboard();
      loadAdsTable();
      loadConfig();
      startRealtimeListeners();
      showToast('Firebase conectado ✓', 'success');
    });
  }

  /* ═══════════════════════════════════════════
     REALTIME — Admin atualiza ao vivo
  ═══════════════════════════════════════════ */
  function startRealtimeListeners() {
    Storage.listenAds(ads => {
      allAds = ads;
      renderAdsTable(ads);
      updateDashboardStats(ads);
    });

    Storage.listenConfig(config => {
      updateDashboardConfig(config);
    });
  }

  /* ═══════════════════════════════════════════
     NAVIGATION
  ═══════════════════════════════════════════ */
  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        switchSection(item.dataset.section, item);
      });
    });
  }

  function switchSection(name, navEl) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    else document.querySelector(`[data-section="${name}"]`)?.classList.add('active');
    $('section-' + name)?.classList.add('active');

    const titles = {
      dashboard: ['Dashboard', 'Visão geral do sistema'],
      ads:       ['Anúncios', 'Gerenciar lista de anúncios'],
      upload:    ['Upload', 'Adicionar novo anúncio'],
      config:    ['Configurações', 'Ajustes do player'],
    };
    const [title, sub] = titles[name] || ['—', ''];
    $('pageTitle').textContent    = title;
    $('pageSubtitle').textContent = sub;

    if (name === 'config') loadConfig();
  }

  /* ═══════════════════════════════════════════
     CLOCK
  ═══════════════════════════════════════════ */
  function startClock() {
    const tick = () => { const el = $('adminClock'); if (el) el.textContent = new Date().toLocaleTimeString('pt-BR'); };
    tick(); setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════
     DASHBOARD
  ═══════════════════════════════════════════ */
  async function loadDashboard() {
    const ads    = await Storage.getAds();
    const config = await Storage.getConfig();
    allAds = ads;
    updateDashboardStats(ads);
    updateDashboardConfig(config);
  }

  function updateDashboardStats(ads) {
    const active = ads.filter(a => a.active);
    $('stat-total-ads').textContent  = ads.length;
    $('stat-active-ads').textContent = active.length;

    const queueList = $('adQueueList');
    const badge     = $('queueBadge');
    if (badge) badge.textContent = active.length;

    if (!active.length) {
      queueList.innerHTML = '<div class="empty-state">Nenhum anúncio ativo.</div>';
    } else {
      queueList.innerHTML = active.map(ad => `
        <div class="queue-item">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="priority-dot priority-${ad.priority}"></span>
            <span class="queue-item-name">${escHtml(ad.name)}</span>
          </div>
          <span class="queue-item-meta">${ad.duration}s · P${ad.priority}</span>
        </div>
      `).join('');
    }
  }

  function updateDashboardConfig(config) {
    $('stat-interval').textContent = (config.schedule?.intervalMinutes || 2) + 'min';
    $('stat-yt-id').textContent    = config.youtube?.videoId || '—';
    const qyt = $('quickYtInput');
    if (qyt && !qyt.matches(':focus')) qyt.value = config.youtube?.videoId || '';
  }

  /* ═══════════════════════════════════════════
     PLAYER CONTROLS
  ═══════════════════════════════════════════ */
  function forceAd() {
    Storage.broadcast('FORCE_AD');
    showToast('Anúncio forçado', 'success');
  }

  function resetTimer() {
    Storage.broadcast('RESET_TIMER');
    showToast('Timer reiniciado');
  }

  async function quickUpdateYT() {
    const id = $('quickYtInput')?.value?.trim();
    if (!id) { showToast('ID inválido', 'error'); return; }
    await Storage.updateConfig({ youtube: { videoId: id } });
    showToast('YouTube atualizado: ' + id, 'success');
  }

  /* ═══════════════════════════════════════════
     ADS TABLE
  ═══════════════════════════════════════════ */
  async function loadAdsTable() {
    allAds = await Storage.getAds();
    renderAdsTable(allAds);
  }

  function renderAdsTable(ads, filter = '') {
    const filtered = filter
      ? ads.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
      : ads;

    const tbody = $('adsTableBody');
    const empty = $('adsEmptyState');

    if (!filtered.length) {
      tbody.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    const pl = { 1: 'Baixa', 2: 'Média', 3: 'Alta' };
    tbody.innerHTML = filtered.map(ad => `
      <tr>
        <td class="td-name">${escHtml(ad.name)}</td>
        <td>${ad.duration}s</td>
        <td><span class="priority-badge"><span class="priority-dot priority-${ad.priority}"></span>${pl[ad.priority]||ad.priority}</span></td>
        <td><span class="badge ${ad.active ? 'badge-active' : 'badge-inactive'}">${ad.active ? 'Ativo' : 'Inativo'}</span></td>
        <td>
          <div class="table-actions">
            <button class="tbl-btn" onclick="AdminController.editAd('${ad.id}')">Editar</button>
            <button class="tbl-btn" onclick="AdminController.toggleAdStatus('${ad.id}')">${ad.active ? 'Desativar' : 'Ativar'}</button>
            <button class="tbl-btn del" onclick="AdminController.deleteAd('${ad.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function filterAds(value) { renderAdsTable(allAds, value); }

  async function toggleAdStatus(id) {
    await Storage.toggleAd(id);
    showToast('Status atualizado');
  }

  async function deleteAd(id) {
    const ad = await Storage.getAdById(id);
    if (!ad || !confirm(`Excluir "${ad.name}"?`)) return;
    await Storage.deleteAd(id);
    showToast('Anúncio excluído', 'success');
  }

  /* ═══════════════════════════════════════════
     MODAL EDITAR
  ═══════════════════════════════════════════ */
  async function openAdModal(id = null) {
    editingAdId = id;
    $('adModal').classList.remove('hidden');
    if (id) {
      const ad = await Storage.getAdById(id);
      $('modalTitle').textContent    = 'Editar Anúncio';
      $('modalAdName').value         = ad.name;
      $('modalAdUrl').value          = ad.url;
      $('modalAdDuration').value     = ad.duration;
      $('modalAdPriority').value     = ad.priority;
      $('modalAdActive').checked     = ad.active;
    } else {
      $('modalTitle').textContent    = 'Novo Anúncio';
      $('modalAdName').value         = '';
      $('modalAdUrl').value          = '';
      $('modalAdDuration').value     = '';
      $('modalAdPriority').value     = '3';
      $('modalAdActive').checked     = true;
    }
  }

  function closeAdModal() { $('adModal').classList.add('hidden'); editingAdId = null; }

  function editAd(id) { openAdModal(id); }

  async function saveAdFromModal() {
    const name     = $('modalAdName').value.trim();
    const url      = $('modalAdUrl').value.trim();
    const duration = parseInt($('modalAdDuration').value) || 15;
    const priority = parseInt($('modalAdPriority').value) || 1;
    const active   = $('modalAdActive').checked;

    if (!name || !url) { showToast('Nome e URL são obrigatórios', 'error'); return; }

    await Storage.saveAd({ id: editingAdId || null, name, url, duration, priority, active, tags: [] });
    closeAdModal();
    showToast(editingAdId ? 'Anúncio atualizado' : 'Anúncio criado', 'success');
  }

  /* ═══════════════════════════════════════════
     UPLOAD
  ═══════════════════════════════════════════ */
  function setupDropZone() {
    const zone = $('dropZone');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
  }

  function handleFileSelect(e) { const f = e.target.files[0]; if (f) processFile(f); }

  function processFile(file) {
    if (!file.type.startsWith('video/')) { showToast('Apenas vídeos', 'error'); return; }
    const url = URL.createObjectURL(file);
    const vid = $('previewVideo');
    vid.src = url;
    $('fileName').textContent = file.name;
    $('fileSize').textContent = formatBytes(file.size);
    $('filePreview').classList.remove('hidden');
    $('adUrl').value = url;
    if (!$('adName').value) $('adName').value = file.name.replace(/\.[^.]+$/, '');
    vid.onloadedmetadata = () => { $('adDuration').value = Math.round(vid.duration) || 30; };
  }

  async function saveAd() {
    const name     = $('adName').value.trim();
    const url      = $('adUrl').value.trim();
    const duration = parseInt($('adDuration').value) || 15;
    const priority = parseInt($('adPriority').value) || 1;
    const tags     = $('adTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const active   = $('adActive').checked;

    if (!name) { showToast('Nome é obrigatório', 'error'); return; }
    if (!url)  { showToast('URL é obrigatória', 'error'); return; }

    await Storage.saveAd({ name, url, duration, priority, tags, active });
    ['adName','adUrl','adDuration','adTags'].forEach(id => $(id) && ($(id).value = ''));
    $('adPriority').value = '3';
    $('adActive').checked = true;
    $('filePreview')?.classList.add('hidden');
    showToast('Anúncio salvo!', 'success');
  }

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  async function loadConfig() {
    const c = await Storage.getConfig();
    $('cfgYtId').value          = c.youtube?.videoId    || '';
    $('cfgYtPlaylist') && ($('cfgYtPlaylist').value     = c.youtube?.playlistId || '');
    $('cfgYtStart').value       = c.youtube?.startAt    || 0;
    $('cfgYtMuted').checked     = c.youtube?.muted      !== false;
    $('cfgYtLoop').checked      = c.youtube?.loop       !== false;
    $('cfgInterval').value      = c.schedule?.intervalMinutes || 2;
    $('cfgMaxSeq').value        = c.schedule?.maxSequential   || 1;
    $('cfgRotation').value      = c.schedule?.rotation        || 'sequential';
    $('cfgSkipBtn').checked     = c.schedule?.showSkipBtn     !== false;
    $('cfgPipPos').value        = c.ui?.pipPosition   || 'bottom-right';
    $('cfgStatusBar').checked   = c.ui?.showStatusBar !== false;
    $('cfgTransitions').checked = c.ui?.transitions   !== false;
  }

  async function saveConfig() {
    const config = {
      youtube: {
        videoId:    $('cfgYtId').value.trim(),
        playlistId: $('cfgYtPlaylist') ? $('cfgYtPlaylist').value.trim() : '',
        startAt:    parseInt($('cfgYtStart').value) || 0,
        muted:      $('cfgYtMuted').checked,
        loop:       $('cfgYtLoop').checked,
      },
      schedule: {
        intervalMinutes: parseFloat($('cfgInterval').value) || 2,
        maxSequential:   parseInt($('cfgMaxSeq').value)     || 1,
        rotation:        $('cfgRotation').value,
        showSkipBtn:     $('cfgSkipBtn').checked,
      },
      ui: {
        pipPosition:   $('cfgPipPos').value,
        showStatusBar: $('cfgStatusBar').checked,
        transitions:   $('cfgTransitions').checked,
      },
    };
    await Storage.saveConfig(config);
    showToast('Configurações salvas!', 'success');
  }

  async function exportConfig() {
    const data = await Storage.exportAll();
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `signage-backup-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('Exportado!', 'success');
  }

  function importConfigClick() { $('importInput').click(); }

  async function importConfig(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const ok = await Storage.importAll(ev.target.result);
      if (ok) { showToast('Importado!', 'success'); loadConfig(); }
      else showToast('Erro ao importar', 'error');
    };
    reader.readAsText(file);
  }

  async function resetAll() {
    if (!confirm('Resetar tudo para o padrão?')) return;
    await Storage.resetAll();
    showToast('Resetado!', 'success');
    loadConfig();
  }

  /* ═══════════════════════════════════════════
     TOAST
  ═══════════════════════════════════════════ */
  function showToast(msg, type = 'info') {
    const container = $('adminToastContainer');
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
  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024**2) return (b/1024).toFixed(1) + ' KB';
    return (b/1024**2).toFixed(1) + ' MB';
  }

  document.addEventListener('DOMContentLoaded', () => { init(); setupDropZone(); });

  return {
    forceAd, resetTimer, quickUpdateYT,
    loadAdsTable, filterAds, editAd, deleteAd, toggleAdStatus,
    openAdModal, closeAdModal, saveAdFromModal,
    handleFileSelect, saveAd,
    saveConfig, exportConfig, importConfigClick, importConfig, resetAll,
  };
})();
