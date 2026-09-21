'use strict';

/**
 * FindAnything - Renderer Logic
 * ------------------------------
 * - First-launch permission modal flow
 * - Settings panel (include / exclude folder management)
 * - Instant search with 40ms keystroke debounce (30–50ms spec range)
 * - Google Desktop-style result rendering: clickable title, highlighted
 *   content snippet subscript, and OS-formatted metadata subscript.
 */

(function () {
  const api = window.findanything;

  // ---------------- DOM references ----------------
  const els = {
    permissionOverlay: document.getElementById('permission-overlay'),
    btnGrant: document.getElementById('btn-grant'),
    btnDeny: document.getElementById('btn-deny'),
    permDeniedNote: document.getElementById('perm-denied-note'),
    app: document.getElementById('app'),
    searchInput: document.getElementById('search-input'),
    btnClear: document.getElementById('btn-clear'),
    btnSettings: document.getElementById('btn-settings'),
    throttleBadge: document.getElementById('throttle-badge'),
    resultStats: document.getElementById('result-stats'),
    indexStats: document.getElementById('index-stats'),
    results: document.getElementById('results'),
    emptyState: document.getElementById('empty-state'),
    settingsOverlay: document.getElementById('settings-overlay'),
    includeList: document.getElementById('include-list'),
    excludeList: document.getElementById('exclude-list'),
    btnAddInclude: document.getElementById('btn-add-include'),
    btnAddExclude: document.getElementById('btn-add-exclude'),
    settingsStats: document.getElementById('settings-stats'),
    btnPauseIndex: document.getElementById('btn-pause-index'),
    btnResumeIndex: document.getElementById('btn-resume-index'),
    btnRebuild: document.getElementById('btn-rebuild'),
    btnCloseSettings: document.getElementById('btn-close-settings')
  };

  const DEBOUNCE_MS = 40; // within the required 30–50ms window
  const MAX_RESULTS = 100;

  let platformInfo = { platform: 'unknown', pathSeparator: '/' };
  let debounceTimer = null;
  let lastQuery = '';
  let searchSeq = 0; // guards against out-of-order async responses

  // ---------------- Boot ----------------

  async function boot() {
    const [cfgRes, platRes] = await Promise.all([api.getConfig(), api.getPlatform()]);
    if (platRes.ok) platformInfo = platRes.data;

    const cfg = cfgRes.ok ? cfgRes.data : { permissionGranted: false };
    if (!cfg.permissionGranted) {
      els.permissionOverlay.classList.remove('hidden');
    } else {
      showApp();
    }

    wireEvents();
    refreshIndexStats();
    setInterval(refreshIndexStats, 5000);
  }

  function showApp() {
    els.permissionOverlay.classList.add('hidden');
    els.app.classList.remove('hidden');
    els.searchInput.focus();
  }

  // ---------------- Permission flow ----------------

  async function onGrant() {
    const res = await api.grantPermission();
    if (res.ok) {
      showApp();
      // Immediately offer to choose the first folders to index.
      openSettings();
      const picked = await api.pickDirectory();
      if (picked.ok && picked.data.length > 0) {
        for (const dir of picked.data) await api.addIncludeDir(dir);
        renderSettingsLists(res.data);
        refreshIndexStats();
      }
    }
  }

  function onDeny() {
    els.permDeniedNote.classList.remove('hidden');
  }

  // ---------------- Settings panel ----------------

  function openSettings() {
    els.settingsOverlay.classList.remove('hidden');
    renderSettings();
  }

  function closeSettings() {
    els.settingsOverlay.classList.add('hidden');
    els.searchInput.focus();
  }

  async function renderSettings() {
    const res = await api.getConfig();
    if (!res.ok) return;
    renderSettingsLists(res.data);
    const stats = await api.getIndexStats();
    if (stats.ok && stats.data.db) {
      els.settingsStats.innerHTML =
        `Files indexed: <strong>${stats.data.db.fileCount.toLocaleString()}</strong><br>` +
        `Files with searchable text: <strong>${(stats.data.db.contentFileCount || 0).toLocaleString()}</strong><br>` +
        `Index database size: <strong>${formatSize(stats.data.db.dbSizeBytes)}</strong><br>` +
        `Indexer state: <strong>${stats.data.indexer ? stats.data.indexer.state : 'idle'}</strong>`;
    }
  }

  function renderSettingsLists(cfg) {
    renderDirList(els.includeList, cfg.includeDirs, async (dir) => {
      await api.removeIncludeDir(dir);
      renderSettings();
    });
    renderDirList(els.excludeList, cfg.excludeDirs, async (dir) => {
      await api.removeExcludeDir(dir);
      renderSettings();
    });
  }

  function renderDirList(ul, dirs, onRemove) {
    ul.innerHTML = '';
    if (!dirs || dirs.length === 0) {
      const li = document.createElement('li');
      li.textContent = '(none)';
      li.style.color = 'var(--text-faint)';
      ul.appendChild(li);
      return;
    }
    for (const dir of dirs) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = formatPath(dir);
      const btn = document.createElement('button');
      btn.className = 'remove';
      btn.textContent = '×';
      btn.title = 'Remove';
      btn.addEventListener('click', () => onRemove(dir));
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }

  async function onAddInclude() {
    const picked = await api.pickDirectory();
    if (picked.ok && picked.data.length > 0) {
      for (const dir of picked.data) await api.addIncludeDir(dir);
      renderSettings();
      refreshIndexStats();
    }
  }

  async function onAddExclude() {
    const picked = await api.pickDirectory();
    if (picked.ok && picked.data.length > 0) {
      for (const dir of picked.data) await api.addExcludeDir(dir);
      renderSettings();
    }
  }

  // ---------------- Instant search (debounced keystrokes) ----------------

  function onSearchInput() {
    const q = els.searchInput.value;
    els.btnClear.classList.toggle('hidden', q.length === 0);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  }

  async function runSearch(query) {
    const trimmed = query.trim();
    lastQuery = trimmed;
    const seq = ++searchSeq;

    if (trimmed.length === 0) {
      renderResults([], '');
      els.resultStats.textContent = '';
      return;
    }

    const res = await api.search(trimmed, { limit: MAX_RESULTS });

    // A newer keystroke already fired — discard this stale response.
    if (seq !== searchSeq || trimmed !== lastQuery) return;

    if (!res.ok) {
      els.resultStats.textContent = 'Search error: ' + res.error;
      return;
    }

    renderResults(res.data.results, trimmed);
    const took = res.data.tookMs < 1 ? '<1' : res.data.tookMs.toFixed(1);
    els.resultStats.textContent =
      `${res.data.total.toLocaleString()} result${res.data.total === 1 ? '' : 's'} in ${took} ms`;
  }

  // ---------------- Result rendering (Google Desktop subscript style) ----------------

  function renderResults(results, query) {
    els.results.innerHTML = '';

    if (!query) {
      els.results.appendChild(els.emptyState);
      els.emptyState.classList.remove('hidden');
      return;
    }

    if (results.length === 0) {
      const div = document.createElement('div');
      div.className = 'empty-state';
      div.innerHTML = '<p>No results found. Try different keywords, or add more folders in Settings.</p>';
      els.results.appendChild(div);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const r of results) {
      frag.appendChild(buildResultItem(r, query));
    }
    els.results.appendChild(frag);
  }

  function buildResultItem(r, query) {
    const item = document.createElement('div');
    item.className = 'result-item';

    // --- Top line: clickable file name / document title ---
    const title = document.createElement('a');
    title.className = 'result-title';
    title.textContent = r.fileName;
    title.title = 'Open ' + formatPath(r.path);
    title.addEventListener('click', () => api.openFile(r.path));
    item.appendChild(title);

    const kind = document.createElement('span');
    kind.className = 'result-kind';
    kind.textContent = r.extension.replace('.', '') || 'file';
    item.appendChild(kind);

    // --- Subscript: dynamic snippet with highlighted search terms ---
    const snippet = document.createElement('div');
    snippet.className = 'result-snippet';
    snippet.innerHTML = buildSnippetHtml(r.snippet, query);
    item.appendChild(snippet);

    // --- Metadata subscript: OS path, size, modified date ---
    const meta = document.createElement('div');
    meta.className = 'result-meta';

    const pathSpan = document.createElement('span');
    pathSpan.textContent = formatPath(r.path);
    meta.appendChild(pathSpan);

    meta.appendChild(sep());
    meta.appendChild(document.createTextNode(formatSize(r.fileSize)));

    meta.appendChild(sep());
    meta.appendChild(document.createTextNode(formatDate(r.modifiedAt)));

    const reveal = document.createElement('span');
    reveal.className = 'reveal-link';
    reveal.textContent = platformInfo.platform === 'darwin' ? 'Reveal in Finder' : 'Show in folder';
    reveal.addEventListener('click', () => api.revealFile(r.path));
    meta.appendChild(reveal);

    item.appendChild(meta);
    return item;
  }

  function sep() {
    const s = document.createElement('span');
    s.className = 'sep';
    s.textContent = '–';
    return s;
  }

  /**
   * Build snippet HTML: escape everything first, then wrap the exact typed
   * search terms in highlight tags. FTS5 already returns «» markers around
   * matched terms; we convert those to <mark> and additionally bold any
   * remaining literal occurrences of the typed terms.
   */
  function buildSnippetHtml(snippet, query) {
    if (!snippet) return '<span style="color:var(--text-faint)">(matched on file name)</span>';

    // Escape HTML entities.
    let html = escapeHtml(snippet);

    // Convert FTS5 markers «term» into <mark>term</mark>.
    html = html.replace(/«/g, '<mark>').replace(/»/g, '</mark>');

    // Additionally highlight literal typed terms that are NOT already
    // wrapped in a <mark>…</mark> element (skip tag interiors and existing
    // mark contents to avoid nested duplicates).
    const terms = extractTerms(query);
    for (const term of terms) {
      if (!term) continue;
      const re = new RegExp(
        '(?![^<]*>)(?!<mark>)(' + escapeRegExp(escapeHtml(term)) + ')(?!</mark>)',
        'gi'
      );
      html = html.replace(re, '<mark>$1</mark>');
    }
    return html;
  }

  function extractTerms(query) {
    return query
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((t) => t.length > 0);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---------------- Formatting helpers ----------------

  /** Render a path using the host OS's native separators. */
  function formatPath(p) {
    if (!p) return '';
    if (platformInfo.platform === 'win32') {
      return p.replace(/\//g, '\\');
    }
    return p.replace(/\\/g, '/');
  }

  function formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return date + ' ' + time;
  }

  // ---------------- Index stats & throttle badge ----------------

  async function refreshIndexStats() {
    const res = await api.getIndexStats();
    if (!res.ok || !res.data.db) {
      els.indexStats.textContent = '';
      return;
    }
    const { db, indexer } = res.data;
    let text = `${db.fileCount.toLocaleString()} files indexed`;
    if (db.contentFileCount != null) {
      text += ` · ${db.contentFileCount.toLocaleString()} with searchable text`;
    }
    if (indexer && indexer.state === 'crawling') {
      text += ` · scanning… ${indexer.processedThisRun.toLocaleString()} processed`;
    } else if (indexer && indexer.state === 'paused') {
      text += ' · indexer paused';
    }
    els.indexStats.textContent = text;
  }

  // ---------------- Event wiring ----------------

  function wireEvents() {
    els.btnGrant.addEventListener('click', onGrant);
    els.btnDeny.addEventListener('click', onDeny);
    els.searchInput.addEventListener('input', onSearchInput);
    els.btnClear.addEventListener('click', () => {
      els.searchInput.value = '';
      onSearchInput();
      els.searchInput.focus();
    });
    els.btnSettings.addEventListener('click', openSettings);
    els.btnCloseSettings.addEventListener('click', closeSettings);
    els.btnAddInclude.addEventListener('click', onAddInclude);
    els.btnAddExclude.addEventListener('click', onAddExclude);
    els.btnPauseIndex.addEventListener('click', async () => { await api.pauseIndexing(); renderSettings(); });
    els.btnResumeIndex.addEventListener('click', async () => { await api.resumeIndexing(); renderSettings(); });
    els.btnRebuild.addEventListener('click', async () => { await api.rebuildIndex(); renderSettings(); });

    // Keyboard shortcut: Ctrl/Cmd+K focuses search, Esc closes settings.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
      }
      if (e.key === 'Escape' && !els.settingsOverlay.classList.contains('hidden')) {
        closeSettings();
      }
    });

    api.onIndexerProgress(() => refreshIndexStats());
    api.onThrottleChange((state) => {
      els.throttleBadge.classList.toggle('hidden', state !== 'paused');
      refreshIndexStats();
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
