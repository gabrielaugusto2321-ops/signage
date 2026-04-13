/**
 * SignageOS — Admin Controller (admin.js)
 *
 * Funcionalidades:
 *  - Navegação entre seções
 *  - CRUD de anúncios
 *  - Upload com drag & drop + preview
 *  - Configurações com sync em tempo real ao Player
 *  - Export/Import JSON
 *  - Clock e dashboard stats
 */

const AdminController = (() => {
  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */
  let editingAdId = null;
  let allAds      = [];
  let filteredAds = [];

  const $ = id => document.getElementById(id);

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  function init() {
    setupNavigation();
    startClock();
    loadDashboard();
    loadAdsTable();
    loadConfig();
    setupDropZone();

    // Escuta updates do Player para manter dashboard sincronizado
    Storage.onMessage(() => {
      loadDashboard();
    });
  }

  /* ═══════════════════════════════════════════
     NAVIGATION
  ═══════════════════════════════════════════ */
  function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const section = item.dataset.section;
        switchSection(section, item);
      });
    });
  }

  function switchSection(sectionName, navEl) {
    // Deactivate all
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));

    // Activate selected
    if (navEl) navEl.classList.add('active');
    else {
      document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');
    }

    const section = $('section-' + sectionName);
    if (section) section.classList.add('active');

    // Update header
    const titles = {
      dashboard: ['Dashboard', 'Visão geral do sistema'],
      ads:       ['Anúncios', 'Gerenciar lista de anúncios'],
      upload:    ['Upload', 'Adicionar novo anúncio'],
      config:    ['Configurações', 'Ajustes do player e agendamento'],
    };
    const [title, subtitle] = titles[sectionName] || ['—', ''];
    $('pageTitle').textContent    = title;
    $('pageSubtitle').textContent = subtitle;

    // Refresh data on section enter
    if (sectionName === 'dashboard') loadDashboard();
    if (sectionName === 'ads')       loadAdsTable();
    if (sectionName === 'upload')    loadLocalStorageList();
    if (sectionName === 'config')    loadConfig();
  }

  /* ═══════════════════════════════════════════
     CLOCK
  ═══════════════════════════════════════════ */
  function startClock() {
    const tick = () => {
      const now = new Date();
      const el  = $('adminClock');
      if (el) el.textContent = now.toLocaleTimeString('pt-BR');
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ═══════════════════════════════════════════
     DASHBOARD
  ═══════════════════════════════════════════ */
  function loadDashboard() {
    const ads    = Storage.getAds();
    const active = ads.filter(a => a.active);
    const config = Storage.getConfig();

    // Stats
    $('stat-total-ads').textContent = ads.length;
    $('stat-active-ads').textContent = active.length;
    $('stat-interval').textContent   = config.schedule.intervalMinutes + 'min';
    $('stat-yt-id').textContent       = config.youtube.videoId || '—';

    // Quick YT input
    const qyt = $('quickYtInput');
    if (qyt) qyt.value = config.youtube.videoId || '';

    // Queue list
    const queueList = $('adQueueList');
    const badge     = $('queueBadge');

    if (active.length === 0) {
      queueList.innerHTML = '<div class="empty-state">Nenhum anúncio ativo.</div>';
      if (badge) badge.textContent = '0';
    } else {
      if (badge) badge.textContent = active.length;
      queueList.innerHTML = active.map(ad => `
        <div class="queue-item">
          <div class="queue-item-left" style="display:flex;align-items:center;gap:8px;">
            <span class="priority-dot priority-${ad.priority}"></span>
            <span class="queue-item-name">${escHtml(ad.name)}</span>
          </div>
          <span class="queue-item-meta">${ad.duration}s · P${ad.priority}</span>
        </div>
      `).join('');
    }
  }

  /* ═══════════════════════════════════════════
     PLAYER CONTROLS (Dashboard)
  ═══════════════════════════════════════════ */
  function forceAd() {
    Storage.broadcast('FORCE_AD');
    showToast('Anúncio forçado no player', 'success');
  }

  function resetTimer() {
    Storage.broadcast('RESET_TIMER');
    showToast('Timer reiniciado');
  }

  function quickUpdateYT() {
    const id = $('quickYtInput')?.value?.trim();
    if (!id) { showToast('ID inválido', 'error'); return; }
    Storage.updateConfig({ youtube: { videoId: id } });
    Storage.broadcast('CHANGE_YT', { videoId: id });
    loadDashboard();
    showToast('YouTube atualizado: ' + id, 'success');
  }

  /* ═══════════════════════════════════════════
     ADS TABLE
  ═══════════════════════════════════════════ */
  function loadAdsTable(filter = '') {
    allAds      = Storage.getAds();
    filteredAds = filter
      ? allAds.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
      : [...allAds];

    const tbody   = $('adsTableBody');
    const empty   = $('adsEmptyState');

    if (!filteredAds.length) {
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const priorityLabel = { 1: 'Baixa', 2: 'Média', 3: 'Alta' };

    tbody.innerHTML = filteredAds.map(ad => `
      <tr>
        <td class="td-name">${escHtml(ad.name)}</td>
        <td>${ad.duration}s</td>
        <td>
          <span class="priority-badge">
            <span class="priority-dot priority-${ad.priority}"></span>
            ${priorityLabel[ad.priority] || ad.priority}
          </span>
        </td>
        <td>
          <span class="badge ${ad.active ? 'badge-active' : 'badge-inactive'}">
            ${ad.active ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <div class="table-actions">
            <button class="tbl-btn" onclick="AdminController.editAd('${ad.id}')">Editar</button>
            <button class="tbl-btn" onclick="AdminController.toggleAdStatus('${ad.id}')">
              ${ad.active ? 'Desativar' : 'Ativar'}
            </button>
            <button class="tbl-btn del" onclick="AdminController.deleteAd('${ad.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function filterAds(value) {
    loadAdsTable(value);
  }

  function toggleAdStatus(id) {
    const newState = Storage.toggleAd(id);
    Storage.broadcast('ADS_UPDATED');
    loadAdsTable();
    loadDashboard();
    showToast(newState ? 'Anúncio ativado' : 'Anúncio desativado');
  }

  function deleteAd(id) {
    const ad = Storage.getAdById(id);
    if (!ad) return;
    if (!confirm(`Excluir "${ad.name}"?`)) return;
    Storage.deleteAd(id);
    Storage.broadcast('ADS_UPDATED');
    loadAdsTable();
    loadDashboard();
    showToast('Anúncio excluído', 'success');
  }

  /* ═══════════════════════════════════════════
     AD MODAL (edit)
  ═══════════════════════════════════════════ */
  function openAdModal(id = null) {
    editingAdId = id;
    const modal = $('adModal');
    modal.classList.remove('hidden');

    if (id) {
      const ad = Storage.getAdById(id);
      $('modalTitle').textContent         = 'Editar Anúncio';
      $('modalAdName').value              = ad.name;
      $('modalAdUrl').value               = ad.url;
      $('modalAdDuration').value          = ad.duration;
      $('modalAdPriority').value          = ad.priority;
      $('modalAdActive').checked          = ad.active;
    } else {
      $('modalTitle').textContent = 'Novo Anúncio';
      ['modalAdName','modalAdUrl','modalAdDuration'].forEach(i => $('i') && ($(`#${i}`) || $(i)) ? $(i).value = '' : null);
      $('modalAdName').value     = '';
      $('modalAdUrl').value      = '';
      $('modalAdDuration').value = '';
      $('modalAdPriority').value = '3';
      $('modalAdActive').checked = true;
    }
  }

  function closeAdModal() {
    $('adModal').classList.add('hidden');
    editingAdId = null;
  }

  function editAd(id) {
    switchSection('ads');
    openAdModal(id);
  }

  function saveAdFromModal() {
    const name     = $('modalAdName').value.trim();
    const url      = $('modalAdUrl').value.trim();
    const duration = parseInt($('modalAdDuration').value) || 15;
    const priority = parseInt($('modalAdPriority').value) || 1;
    const active   = $('modalAdActive').checked;

    if (!name || !url) { showToast('Nome e URL são obrigatórios', 'error'); return; }

    const ad = {
      id:       editingAdId || null,
      name, url, duration, priority, active,
      tags:     [],
    };

    Storage.saveAd(ad);
    Storage.broadcast('ADS_UPDATED');
    closeAdModal();
    loadAdsTable();
    loadDashboard();
    showToast(editingAdId ? 'Anúncio atualizado' : 'Anúncio criado', 'success');
  }

  /* ═══════════════════════════════════════════
     UPLOAD SECTION
  ═══════════════════════════════════════════ */
  function setupDropZone() {
    const zone  = $('dropZone');
    if (!zone) return;

    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    });
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processFile(file);
  }

  function processFile(file) {
    if (!file.type.startsWith('video/')) {
      showToast('Apenas arquivos de vídeo são aceitos', 'error');
      return;
    }

    const url     = URL.createObjectURL(file);
    const preview = $('filePreview');
    const video   = $('previewVideo');
    const nameEl  = $('fileName');
    const sizeEl  = $('fileSize');

    video.src    = url;
    nameEl.textContent = file.name;
    sizeEl.textContent = formatBytes(file.size);
    preview.classList.remove('hidden');

    // Auto-fill form
    $('adUrl').value = url;
    if (!$('adName').value) {
      $('adName').value = file.name.replace(/\.[^.]+$/, '');
    }

    // Auto-detect duration
    video.onloadedmetadata = () => {
      $('adDuration').value = Math.round(video.duration) || 30;
    };
  }

  function saveAd() {
    const name     = $('adName').value.trim();
    const url      = $('adUrl').value.trim();
    const duration = parseInt($('adDuration').value) || 15;
    const priority = parseInt($('adPriority').value) || 1;
    const tags     = $('adTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const active   = $('adActive').checked;

    if (!name) { showToast('Nome é obrigatório', 'error'); return; }
    if (!url)  { showToast('URL ou arquivo é obrigatório', 'error'); return; }

    const ad = { name, url, duration, priority, tags, active };
    Storage.saveAd(ad);
    Storage.broadcast('ADS_UPDATED');

    // Reset form
    ['adName','adUrl','adDuration','adTags'].forEach(id => $(id) && ($(id).value = ''));
    $('adPriority').value = '3';
    $('adActive').checked = true;
    $('filePreview').classList.add('hidden');

    loadLocalStorageList();
    loadDashboard();
    showToast('Anúncio salvo com sucesso!', 'success');
  }

  function loadLocalStorageList() {
    const ads = Storage.getAds();
    const el  = $('localStorageList');
    if (!el) return;

    if (!ads.length) {
      el.innerHTML = '<div class="empty-state">Nenhum anúncio salvo.</div>';
      return;
    }

    el.innerHTML = ads.map(ad => `
      <div class="ls-item">
        <span>${escHtml(ad.name)}</span>
        <span style="color:var(--mid);font-size:10px;">${ad.duration}s</span>
      </div>
    `).join('');
  }

  /* ═══════════════════════════════════════════
     CONFIG SECTION
  ═══════════════════════════════════════════ */
  function loadConfig() {
    const c = Storage.getConfig();

    // YouTube
    $('cfgYtId').value        = c.youtube.videoId || '';
    $('cfgYtStart').value     = c.youtube.startAt || 0;
    $('cfgYtMuted').checked   = c.youtube.muted !== false;
    $('cfgYtLoop').checked    = c.youtube.loop  !== false;

    // Schedule
    $('cfgInterval').value    = c.schedule.intervalMinutes || 2;
    $('cfgMaxSeq').value      = c.schedule.maxSequential   || 1;
    $('cfgRotation').value    = c.schedule.rotation        || 'sequential';
    $('cfgSkipBtn').checked   = c.schedule.showSkipBtn     !== false;

    // UI
    $('cfgPipPos').value      = c.ui.pipPosition   || 'bottom-right';
    $('cfgStatusBar').checked = c.ui.showStatusBar !== false;
    $('cfgTransitions').checked = c.ui.transitions !== false;
  }

  function saveConfig() {
    const config = {
      youtube: {
        videoId:  $('cfgYtId').value.trim(),
        startAt:  parseInt($('cfgYtStart').value) || 0,
        muted:    $('cfgYtMuted').checked,
        loop:     $('cfgYtLoop').checked,
      },
      schedule: {
        intervalMinutes: parseFloat($('cfgInterval').value) || 2,
        maxSequential:   parseInt($('cfgMaxSeq').value) || 1,
        rotation:        $('cfgRotation').value,
        showSkipBtn:     $('cfgSkipBtn').checked,
      },
      ui: {
        pipPosition:   $('cfgPipPos').value,
        showStatusBar: $('cfgStatusBar').checked,
        transitions:   $('cfgTransitions').checked,
      },
    };

    Storage.saveConfig(config);
    Storage.broadcast('CONFIG_UPDATED');

    // Se mudou o YT ID, sync
    if (config.youtube.videoId) {
      Storage.broadcast('CHANGE_YT', { videoId: config.youtube.videoId });
    }

    loadDashboard();
    showToast('Configurações salvas!', 'success');
  }

  function exportConfig() {
    const data    = Storage.exportAll();
    const blob    = new Blob([data], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `signage-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exportado com sucesso', 'success');
  }

  function importConfigClick() {
    $('importInput').click();
  }

  function importConfig(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const ok = Storage.importAll(ev.target.result);
      if (ok) {
        loadConfig();
        loadAdsTable();
        loadDashboard();
        Storage.broadcast('CONFIG_UPDATED');
        Storage.broadcast('ADS_UPDATED');
        showToast('Importado com sucesso!', 'success');
      } else {
        showToast('Erro ao importar arquivo', 'error');
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm('Isso irá apagar todas as configurações e anúncios. Confirmar?')) return;
    Storage.resetAll();
    Storage.broadcast('CONFIG_UPDATED');
    Storage.broadcast('ADS_UPDATED');
    loadConfig();
    loadAdsTable();
    loadDashboard();
    showToast('Dados resetados para o padrão', 'success');
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
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }, 3000);
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1024**2)    return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024**3)    return (bytes / 1024**2).toFixed(1) + ' MB';
    return (bytes / 1024**3).toFixed(1) + ' GB';
  }

  /* ═══════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', init);

  return {
    // Dashboard
    forceAd, resetTimer, quickUpdateYT,
    // Ads
    loadAdsTable, filterAds, editAd, deleteAd, toggleAdStatus,
    // Modal
    openAdModal, closeAdModal, saveAdFromModal,
    // Upload
    handleFileSelect, saveAd, loadLocalStorageList,
    // Config
    saveConfig, exportConfig, importConfigClick, importConfig, resetAll,
  };
})();
