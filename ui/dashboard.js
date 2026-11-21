(function initMailAuditDashboard() {
  "use strict";

  const api = globalThis.messenger || globalThis.browser;
  const Store = globalThis.MailAuditStore;
  const Actions = globalThis.MailAuditActions;

  if (!api || !Store || !Actions) {
    return;
  }

  const PAGE_SIZE = 50;
  const PENDING_VIEW_KEY = "mailAuditPendingView";

  const VIEW_META = {
    deleted: {
      title: "Silinen Mailler",
      subtitle: "Çöp Kutusu'na atılan veya kalıcı silinen mailleri silinme tarihine göre sıralayın, arayın ve geri yükleyin."
    },
    all: {
      title: "Tüm Mail Günlüğü",
      subtitle: "Gelen aktif mailler ile silinen tüm maillerin geliş ve silinme tarihlerini tek listede inceleyin."
    },
    stats: {
      title: "İstatistikler & Dağılım",
      subtitle: "Son 14 gündeki silme yoğunluğunu, hesap bazlı özetleri ve en çok silme yapılan klasörleri görün."
    },
    tools: {
      title: "Tarama & Yedekleme",
      subtitle: "Mevcut Gelen/Çöp Kutusu maillerini tarayın, CSV/JSON yedeği alın veya yedekten geri yükleyin."
    },
    settings: {
      title: "Ayarlar",
      subtitle: "Otomatik izleme tercihlerini, saklama limitini, rozet sayacını ve tema görünümünü yapılandırın."
    }
  };

  const storageManager = Store.createStorageManager(api.storage.local);

  const state = {
    view: "deleted",
    allRecords: [],
    filteredRecords: [],
    settings: { ...Store.DEFAULT_SETTINGS },
    search: "",
    status: "deleted_any",
    accountId: "all",
    dateField: "deletedAt",
    dateFrom: "",
    dateTo: "",
    sortBy: "deletedAt",
    sortDir: "desc",
    page: 1,
    selectedKeys: new Set(),
    activeDrawerKey: null,
    scanning: false
  };

  const els = {
    sideNav: document.getElementById("side-nav"),
    navCountDeleted: document.getElementById("nav-count-deleted"),
    navCountAll: document.getElementById("nav-count-all"),
    trackingDot: document.getElementById("tracking-dot"),
    trackingText: document.getElementById("tracking-text"),
    btnQuickScan: document.getElementById("btn-quick-scan"),
    btnThemeCycle: document.getElementById("btn-theme-cycle"),
    viewTitle: document.getElementById("view-title"),
    viewSubtitle: document.getElementById("view-subtitle"),
    logHeaderActions: document.getElementById("log-header-actions"),
    scanStatusBar: document.getElementById("scan-status-bar"),

    viewLog: document.getElementById("view-log"),
    viewStats: document.getElementById("view-stats"),
    viewTools: document.getElementById("view-tools"),
    viewSettings: document.getElementById("view-settings"),

    kpiTotal: document.getElementById("kpi-total"),
    kpiTrashed: document.getElementById("kpi-trashed"),
    kpiDeleted: document.getElementById("kpi-deleted"),
    kpiActive: document.getElementById("kpi-active"),
    kpiToday: document.getElementById("kpi-today"),

    statusPills: document.getElementById("status-pills"),
    searchInput: document.getElementById("search-input"),
    accountFilter: document.getElementById("account-filter"),
    sortSelect: document.getElementById("sort-select"),
    dateFieldSelect: document.getElementById("date-field-select"),
    dateFromInput: document.getElementById("date-from-input"),
    dateToInput: document.getElementById("date-to-input"),
    btnResetFilters: document.getElementById("btn-reset-filters"),

    bulkBar: document.getElementById("bulk-action-bar"),
    bulkSelectedText: document.getElementById("bulk-selected-text"),
    btnBulkRestore: document.getElementById("btn-bulk-restore"),
    btnBulkCsv: document.getElementById("btn-bulk-csv"),
    btnBulkRemove: document.getElementById("btn-bulk-remove"),
    btnBulkClear: document.getElementById("btn-bulk-clear"),

    selectAllPage: document.getElementById("select-all-page"),
    tbody: document.getElementById("records-tbody"),
    emptyState: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-state-message"),
    paginationSummary: document.getElementById("pagination-summary"),
    paginationPage: document.getElementById("pagination-page"),
    btnPrevPage: document.getElementById("btn-prev-page"),
    btnNextPage: document.getElementById("btn-next-page"),

    dailyChart: document.getElementById("daily-chart"),
    accountStatsList: document.getElementById("account-stats-list"),
    folderStatsList: document.getElementById("folder-stats-list"),

    scanLimitSelect: document.getElementById("scan-limit-select"),
    btnScanInboxes: document.getElementById("btn-scan-inboxes"),
    btnScanTrash: document.getElementById("btn-scan-trash"),
    btnExportCsv: document.getElementById("btn-export-csv"),
    btnExportJson: document.getElementById("btn-export-json"),
    btnToolsCsvAll: document.getElementById("btn-tools-csv-all"),
    btnToolsJsonAll: document.getElementById("btn-tools-json-all"),
    jsonImportInput: document.getElementById("json-import-input"),

    settingsForm: document.getElementById("settings-form"),
    setTrackIncoming: document.getElementById("set-track-incoming"),
    setTrackTrash: document.getElementById("set-track-trash"),
    setTrackPermanent: document.getElementById("set-track-permanent"),
    setShowBadge: document.getElementById("set-show-badge"),
    setMaxRecords: document.getElementById("set-max-records"),
    setTheme: document.getElementById("set-theme"),

    btnClearTrigger: document.getElementById("btn-clear-trigger"),
    clearConfirmBar: document.getElementById("clear-confirm-bar"),
    btnClearActive: document.getElementById("btn-clear-active"),
    btnClearAll: document.getElementById("btn-clear-all"),
    btnClearCancel: document.getElementById("btn-clear-cancel"),

    drawerBackdrop: document.getElementById("drawer-backdrop"),
    detailDrawer: document.getElementById("detail-drawer"),
    drawerSubject: document.getElementById("drawer-subject"),
    drawerBody: document.getElementById("drawer-body"),
    drawerFooter: document.getElementById("drawer-footer"),
    btnDrawerClose: document.getElementById("btn-drawer-close"),

    toastContainer: document.getElementById("toast-container")
  };

  function showToast(message, variant = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${variant}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function themeLabel(theme) {
    if (theme === "dark") return "Tema: Koyu";
    if (theme === "light") return "Tema: Açık";
    return "Tema: Sistem";
  }

  function formatDeletedDateDisplay(rec) {
    if (rec.deletedAt != null) {
      return Store.formatDateTR(rec.deletedAt);
    }
    if (rec.preExistingTrash) {
      return "Kurulum öncesi";
    }
    return "—";
  }

  function buildStatusBadge(status) {
    const label = Store.formatStatusTR(status);
    let cls = "badge ";
    if (status === "trashed") cls += "badge-trashed";
    else if (status === "deleted") cls += "badge-deleted";
    else cls += "badge-active";
    return createEl("span", cls, label);
  }

  function buildFolderDisplay(rec) {
    if (rec.status === "trashed") {
      if (rec.originalFolderPath && rec.currentFolderPath) {
        return `${rec.originalFolderPath} → ${rec.currentFolderPath}`;
      }
      return rec.currentFolderPath || rec.originalFolderPath || "Çöp Kutusu";
    }
    if (rec.status === "deleted") {
      return rec.originalFolderPath ? `Eski yer: ${rec.originalFolderPath}` : "Sunucudan/diskten silindi";
    }
    return rec.currentFolderPath || rec.originalFolderPath || "—";
  }

  function syncStatusPillsUI() {
    for (const pill of els.statusPills.querySelectorAll(".pill")) {
      pill.classList.toggle("active", pill.dataset.status === state.status);
    }
  }

  function syncSortHeadersUI() {
    const labels = {
      status: "Durum",
      subject: "Mail Adı (Konu) / Gönderen",
      receivedAt: "Geliş Tarihi",
      deletedAt: "Silinme Tarihi"
    };
    for (const btn of document.querySelectorAll(".th-sort-btn")) {
      const col = btn.dataset.sort;
      const arrow = state.sortBy === col ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
      btn.textContent = `${labels[col] || col}${arrow}`;
    }
    const combo = `${state.sortBy}:${state.sortDir}`;
    if (Array.from(els.sortSelect.options).some((o) => o.value === combo)) {
      els.sortSelect.value = combo;
    }
  }

  function switchView(targetView) {
    const valid = VIEW_META[targetView] ? targetView : "deleted";
    state.view = valid;

    for (const btn of els.sideNav.querySelectorAll(".nav-item")) {
      btn.classList.toggle("active", btn.dataset.view === valid);
    }

    els.viewTitle.textContent = VIEW_META[valid].title;
    els.viewSubtitle.textContent = VIEW_META[valid].subtitle;

    const isLogView = valid === "deleted" || valid === "all";
    els.logHeaderActions.classList.toggle("hidden", !isLogView);
    els.viewLog.classList.toggle("hidden", !isLogView);
    els.viewStats.classList.toggle("hidden", valid !== "stats");
    els.viewTools.classList.toggle("hidden", valid !== "tools");
    els.viewSettings.classList.toggle("hidden", valid !== "settings");

    if (valid === "deleted") {
      state.status = "deleted_any";
      state.sortBy = "deletedAt";
      state.sortDir = "desc";
      state.page = 1;
      syncStatusPillsUI();
      renderTable();
    } else if (valid === "all") {
      state.status = "all";
      state.page = 1;
      syncStatusPillsUI();
      renderTable();
    } else if (valid === "stats") {
      renderStats();
    } else if (valid === "settings") {
      populateSettingsForm();
    }
  }

  function updateTrackingIndicator() {
    const anyOn = state.settings.trackIncoming || state.settings.trackTrash || state.settings.trackPermanentDelete;
    els.trackingDot.classList.toggle("paused", !anyOn);
    els.trackingText.textContent = anyOn ? "Otomatik izleme aktif" : "İzleme duraklatıldı";
    els.btnThemeCycle.textContent = themeLabel(state.settings.theme);
  }

  function updateKpisAndNav(stats) {
    els.kpiTotal.textContent = String(stats.total);
    els.kpiTrashed.textContent = String(stats.trashed);
    els.kpiDeleted.textContent = String(stats.deleted);
    els.kpiActive.textContent = String(stats.active);
    els.kpiToday.textContent = String(stats.deletedToday);

    els.navCountDeleted.textContent = String(stats.deletedAny);
    els.navCountAll.textContent = String(stats.total);
  }

  function updateAccountFilterOptions(records) {
    const previous = state.accountId;
    const accountsMap = new Map();

    for (const rec of records) {
      if (rec.accountId && !accountsMap.has(rec.accountId)) {
        accountsMap.set(rec.accountId, rec.accountName || rec.accountId);
      }
    }

    els.accountFilter.textContent = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Tüm Hesaplar";
    els.accountFilter.appendChild(allOpt);

    const sortedEntries = Array.from(accountsMap.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "tr-TR", { sensitivity: "base" })
    );
    for (const [id, name] of sortedEntries) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      els.accountFilter.appendChild(opt);
    }

    if (previous === "all" || accountsMap.has(previous)) {
      els.accountFilter.value = previous;
    } else {
      state.accountId = "all";
      els.accountFilter.value = "all";
    }
  }

  function updateBulkBar(pageItems) {
    const count = state.selectedKeys.size;
    els.bulkBar.classList.toggle("hidden", count === 0);
    els.bulkSelectedText.textContent = `${count} kayıt seçildi`;

    const hasTrashedSelected = state.allRecords.some(
      (r) => state.selectedKeys.has(r.key) && r.status === "trashed"
    );
    els.btnBulkRestore.disabled = !hasTrashedSelected;

    const allOnPageSelected = pageItems.length > 0 && pageItems.every((r) => state.selectedKeys.has(r.key));
    els.selectAllPage.checked = allOnPageSelected;
  }

  function renderTable() {
    syncSortHeadersUI();

    state.filteredRecords = Store.filterAndSortRecords(state.allRecords, {
      search: state.search,
      status: state.status,
      accountId: state.accountId,
      dateField: state.dateField,
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    });

    const total = state.filteredRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    const startIdx = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.filteredRecords.slice(startIdx, startIdx + PAGE_SIZE);

    els.tbody.textContent = "";

    if (total === 0) {
      els.emptyState.classList.remove("hidden");
      els.emptyMessage.textContent = state.allRecords.length > 0
        ? "Seçili filtre, arama veya tarih aralığına uyan kayıt bulunamadı."
        : "Eklenti kurulduktan sonra gelen tüm mailler ve silinen tüm mailler (eski mailler dahil) otomatik olarak burada listelenir. Mevcut mailleri hemen içeri almak için sol menüden Tarama & Yedek bölümünü kullanabilirsiniz.";
      els.paginationSummary.textContent = "0 kayıt";
    } else {
      els.emptyState.classList.add("hidden");
      const endIdx = Math.min(startIdx + pageItems.length, total);
      els.paginationSummary.textContent = `${startIdx + 1}–${endIdx} / ${total} kayıt`;
    }

    els.paginationPage.textContent = `Sayfa ${state.page} / ${totalPages}`;
    els.btnPrevPage.disabled = state.page <= 1;
    els.btnNextPage.disabled = state.page >= totalPages;

    for (const rec of pageItems) {
      const tr = document.createElement("tr");

      // Checkbox
      const tdCheck = createEl("td", "check-col");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedKeys.has(rec.key);
      cb.setAttribute("aria-label", `Seç: ${rec.subject || "Mail"}`);
      cb.addEventListener("change", () => {
        if (cb.checked) state.selectedKeys.add(rec.key);
        else state.selectedKeys.delete(rec.key);
        updateBulkBar(pageItems);
      });
      tdCheck.appendChild(cb);
      tr.appendChild(tdCheck);

      // Durum
      const tdStatus = document.createElement("td");
      tdStatus.appendChild(buildStatusBadge(rec.status));
      tr.appendChild(tdStatus);

      // Konu / Gönderen
      const tdTitle = document.createElement("td");
      const subjectBtn = createEl("button", "subject-btn", rec.subject || "(Konu yok)");
      subjectBtn.type = "button";
      subjectBtn.addEventListener("click", () => openDetailDrawer(rec));
      tdTitle.appendChild(subjectBtn);
      tdTitle.appendChild(createEl("div", "meta-line", rec.author || "Gönderen bilinmiyor"));
      tr.appendChild(tdTitle);

      // Hesap / Klasör
      const tdFolder = document.createElement("td");
      tdFolder.appendChild(createEl("div", "", rec.accountName || rec.accountId || "—"));
      tdFolder.appendChild(createEl("div", "meta-line", buildFolderDisplay(rec)));
      tr.appendChild(tdFolder);

      // Geliş Tarihi
      tr.appendChild(createEl("td", "date-cell", Store.formatDateTR(rec.receivedAt)));

      // Silinme Tarihi
      const tdDeleted = createEl("td", "date-cell");
      tdDeleted.appendChild(document.createTextNode(formatDeletedDateDisplay(rec)));
      if (rec.permanentlyDeletedAt) {
        tdDeleted.appendChild(
          createEl("span", "sub-date", `Kalıcı: ${Store.formatDateTR(rec.permanentlyDeletedAt)}`)
        );
      } else if (rec.restoredAt) {
        tdDeleted.appendChild(
          createEl("span", "sub-date", `Geri alındı: ${Store.formatDateTR(rec.restoredAt)}`)
        );
      }
      tr.appendChild(tdDeleted);

      // İşlemler
      const tdActions = createEl("td", "actions-col");
      const actionsWrap = createEl("div", "row-actions");

      const btnDetail = createEl("button", "btn btn-ghost btn-sm", "Detay");
      btnDetail.type = "button";
      btnDetail.addEventListener("click", () => openDetailDrawer(rec));
      actionsWrap.appendChild(btnDetail);

      if (rec.status !== "deleted") {
        const btnOpen = createEl("button", "btn btn-secondary btn-sm", "Aç");
        btnOpen.type = "button";
        btnOpen.addEventListener("click", () => handleOpenMessage(rec));
        actionsWrap.appendChild(btnOpen);
      }

      if (rec.status === "trashed") {
        const btnRestore = createEl("button", "btn btn-primary btn-sm", "Geri Yükle");
        btnRestore.type = "button";
        btnRestore.addEventListener("click", () => handleRestoreMessage(rec));
        actionsWrap.appendChild(btnRestore);
      }

      tdActions.appendChild(actionsWrap);
      tr.appendChild(tdActions);

      els.tbody.appendChild(tr);
    }

    updateBulkBar(pageItems);
  }

  function renderStats() {
    const stats = Store.computeStatistics(state.allRecords);

    // 14-day bar chart
    els.dailyChart.textContent = "";
    const maxDay = Math.max(1, ...stats.dailyDeletions.map((d) => d.count));
    for (const day of stats.dailyDeletions) {
      const col = createEl("div", "bar-col");
      col.appendChild(createEl("span", "bar-count", day.count > 0 ? String(day.count) : ""));
      const track = createEl("div", "bar-track");
      const fill = createEl("div", "bar-fill");
      const pct = day.count > 0 ? Math.max(6, Math.round((day.count / maxDay) * 100)) : 0;
      fill.style.height = `${pct}%`;
      track.appendChild(fill);
      col.appendChild(track);
      col.appendChild(createEl("span", "bar-label", day.label));
      els.dailyChart.appendChild(col);
    }

    // Accounts breakdown
    els.accountStatsList.textContent = "";
    if (stats.byAccount.length === 0) {
      els.accountStatsList.appendChild(createEl("p", "card-desc", "Henüz hesap verisi yok."));
    } else {
      const maxAcc = Math.max(1, stats.byAccount[0].total);
      for (const acc of stats.byAccount) {
        const row = createEl("div", "stat-row");
        const top = createEl("div", "stat-row-top");
        top.appendChild(createEl("strong", "", acc.accountName));
        top.appendChild(createEl("span", "", `${acc.total} kayıt`));
        row.appendChild(top);
        row.appendChild(
          createEl(
            "div",
            "stat-row-sub",
            `Aktif: ${acc.active} • Çöp: ${acc.trashed} • Kalıcı silinen: ${acc.deleted}`
          )
        );
        const track = createEl("div", "progress-track");
        const fill = createEl("div", "progress-fill");
        fill.style.width = `${Math.round((acc.total / maxAcc) * 100)}%`;
        track.appendChild(fill);
        row.appendChild(track);
        els.accountStatsList.appendChild(row);
      }
    }

    // Top folders
    els.folderStatsList.textContent = "";
    if (stats.topDeletedFolders.length === 0) {
      els.folderStatsList.appendChild(createEl("p", "card-desc", "Henüz silinen mail klasör verisi yok."));
    } else {
      const maxFolder = Math.max(1, stats.topDeletedFolders[0].count);
      for (const item of stats.topDeletedFolders) {
        const row = createEl("div", "stat-row");
        const top = createEl("div", "stat-row-top");
        top.appendChild(createEl("strong", "", item.folder));
        top.appendChild(createEl("span", "", `${item.count} silinen`));
        row.appendChild(top);
        const track = createEl("div", "progress-track");
        const fill = createEl("div", "progress-fill");
        fill.style.width = `${Math.round((item.count / maxFolder) * 100)}%`;
        track.appendChild(fill);
        row.appendChild(track);
        els.folderStatsList.appendChild(row);
      }
    }
  }

  function openDetailDrawer(rec) {
    state.activeDrawerKey = rec.key;
    els.drawerSubject.textContent = rec.subject || "(Konu yok)";
    els.drawerBody.textContent = "";
    els.drawerFooter.textContent = "";

    const rows = [
      { label: "Durum", node: buildStatusBadge(rec.status) },
      { label: "Gönderen", text: rec.author || "—" },
      { label: "Hesap", text: rec.accountName || rec.accountId || "—" },
      { label: "Orijinal Klasör", text: rec.originalFolderPath || "—" },
      { label: "Mevcut Klasör", text: rec.currentFolderPath || "—" },
      { label: "Geliş Tarihi", text: Store.formatDateTR(rec.receivedAt) },
      { label: "Silinme Tarihi", text: formatDeletedDateDisplay(rec) },
      { label: "Kalıcı Silinme Tarihi", text: Store.formatDateTR(rec.permanentlyDeletedAt) },
      { label: "Geri Yüklenme Tarihi", text: Store.formatDateTR(rec.restoredAt) },
      { label: "Günlüğe İlk Eklenme", text: Store.formatDateTR(rec.recordedAt) }
    ];

    for (const item of rows) {
      const wrap = createEl("div", "detail-row");
      wrap.appendChild(createEl("span", "detail-label", item.label));
      if (item.node) {
        wrap.appendChild(item.node);
      } else {
        wrap.appendChild(createEl("div", "detail-value", item.text));
      }
      els.drawerBody.appendChild(wrap);
    }

    if (rec.headerMessageId) {
      const idWrap = createEl("div", "detail-row");
      idWrap.appendChild(createEl("span", "detail-label", "Message-ID"));
      idWrap.appendChild(createEl("div", "detail-mono", rec.headerMessageId));
      const copyBtn = createEl("button", "btn btn-ghost btn-sm", "Message-ID Kopyala");
      copyBtn.type = "button";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(rec.headerMessageId);
          showToast("Message-ID panoya kopyalandı.");
        } catch (_err) {
          showToast("Kopyalanamadı.", "error");
        }
      });
      idWrap.appendChild(copyBtn);
      els.drawerBody.appendChild(idWrap);
    }

    if (rec.status !== "deleted") {
      const btnOpen = createEl("button", "btn btn-secondary btn-sm", "Thunderbird'de Aç");
      btnOpen.type = "button";
      btnOpen.addEventListener("click", () => handleOpenMessage(rec));
      els.drawerFooter.appendChild(btnOpen);
    }

    if (rec.status === "trashed") {
      const btnRestore = createEl("button", "btn btn-primary btn-sm", "Orijinal Klasöre Geri Yükle");
      btnRestore.type = "button";
      btnRestore.addEventListener("click", async () => {
        await handleRestoreMessage(rec);
        closeDetailDrawer();
      });
      els.drawerFooter.appendChild(btnRestore);
    }

    const btnDel = createEl("button", "btn btn-danger-outline btn-sm", "Kaydı Günlükten Sil");
    btnDel.type = "button";
    btnDel.addEventListener("click", async () => {
      await handleRemoveRecord(rec);
      closeDetailDrawer();
    });
    els.drawerFooter.appendChild(btnDel);

    els.drawerBackdrop.classList.remove("hidden");
    els.detailDrawer.classList.remove("hidden");
  }

  function closeDetailDrawer() {
    state.activeDrawerKey = null;
    els.drawerBackdrop.classList.add("hidden");
    els.detailDrawer.classList.add("hidden");
  }

  function populateSettingsForm() {
    const s = state.settings;
    els.setTrackIncoming.checked = Boolean(s.trackIncoming);
    els.setTrackTrash.checked = Boolean(s.trackTrash);
    els.setTrackPermanent.checked = Boolean(s.trackPermanentDelete);
    els.setShowBadge.checked = Boolean(s.showBadgeCount);
    els.setMaxRecords.value = String(s.maxRecords || Store.DEFAULT_MAX_RECORDS);
    els.setTheme.value = s.theme || "system";
  }

  async function handleOpenMessage(rec) {
    try {
      const res = await Actions.openMessage(api, rec);
      if (!res.ok) {
        showToast(res.error, "error");
      }
    } catch (err) {
      console.error("[MailAudit] Mail açılamadı:", err);
      showToast("Mail açılırken bir hata oluştu.", "error");
    }
  }

  async function handleRestoreMessage(rec) {
    try {
      const res = await Actions.restoreMessage(api, Store, rec);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      showToast("Mail orijinal klasörüne geri yüklendi.", "success");
    } catch (err) {
      console.error("[MailAudit] Geri yükleme hatası:", err);
      showToast("Mail geri yüklenemedi.", "error");
    }
  }

  async function handleRemoveRecord(rec) {
    try {
      state.selectedKeys.delete(rec.key);
      await storageManager.removeRecord(rec.key);
      showToast("Kayıt günlükten silindi.");
    } catch (err) {
      console.error("[MailAudit] Kayıt silinemedi:", err);
      showToast("Kayıt silinirken hata oluştu.", "error");
    }
  }

  async function handleBulkRestore() {
    const selectedTrashed = state.allRecords.filter(
      (r) => state.selectedKeys.has(r.key) && r.status === "trashed"
    );
    if (selectedTrashed.length === 0) {
      return;
    }

    let okCount = 0;
    let failCount = 0;
    for (const rec of selectedTrashed) {
      try {
        const res = await Actions.restoreMessage(api, Store, rec);
        if (res.ok) okCount += 1;
        else failCount += 1;
      } catch (_err) {
        failCount += 1;
      }
    }

    state.selectedKeys.clear();
    if (failCount === 0) {
      showToast(`${okCount} mail orijinal klasörüne geri yüklendi.`, "success");
    } else {
      showToast(`${okCount} mail geri yüklendi, ${failCount} mail bulunamadı.`, "error");
    }
  }

  async function handleBulkRemove() {
    const keys = Array.from(state.selectedKeys);
    if (keys.length === 0) return;
    await storageManager.removeRecordsBulk(keys);
    state.selectedKeys.clear();
    showToast(`${keys.length} kayıt günlükten silindi.`);
  }

  async function runFolderScan(specialUse) {
    if (state.scanning) return;
    state.scanning = true;
    els.btnQuickScan.disabled = true;
    els.btnScanInboxes.disabled = true;
    els.btnScanTrash.disabled = true;
    els.scanStatusBar.classList.remove("hidden");

    const label = specialUse === "trash" ? "Çöp Kutuları" : "Gelen Kutuları";
    const maxKeep = Number(els.scanLimitSelect.value) || 500;
    els.scanStatusBar.textContent = `${label} taranıyor...`;

    try {
      const res = await Actions.scanFoldersByUse(api, Store, storageManager, {
        specialUse,
        maxKeep,
        onProgress: ({ index, total, accountName, folderName }) => {
          els.scanStatusBar.textContent = `Taranıyor (${index}/${total}): ${accountName} — ${folderName}`;
        }
      });
      showToast(`${res.folderCount} klasör tarandı, ${res.messageCount} mail işlendi.`, "success");
    } catch (err) {
      console.error("[MailAudit] Tarama hatası:", err);
      showToast(`${label} taranırken bir hata oluştu.`, "error");
    } finally {
      state.scanning = false;
      els.btnQuickScan.disabled = false;
      els.btnScanInboxes.disabled = false;
      els.btnScanTrash.disabled = false;
      els.scanStatusBar.classList.add("hidden");
      els.scanStatusBar.textContent = "";
    }
  }

  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv(records, suffix) {
    const csv = Store.exportRecordsToCsv(records);
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(`mail-tarihce-${suffix}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
    showToast(`${records.length} kayıt CSV olarak indirildi.`);
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: "1.1.0",
      records: state.allRecords
    };
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(
      `mail-tarihce-yedek-${stamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    showToast(`${state.allRecords.length} kayıt JSON yedeği olarak indirildi.`);
  }

  async function handleJsonImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let summary = null;
      await storageManager.updateRecords((map) => {
        const res = Store.importRecordsFromJson(text, map);
        summary = res;
        return res.recordsMap;
      });
      showToast(
        `İçe aktarma tamamlandı: ${summary.importedCount} yeni, ${summary.updatedCount} güncellendi, ${summary.skippedCount} atlandı.`,
        "success"
      );
    } catch (err) {
      console.error("[MailAudit] JSON içe aktarma hatası:", err);
      showToast("Geçersiz JSON dosyası; içe aktarılamadı.", "error");
    } finally {
      els.jsonImportInput.value = "";
    }
  }

  async function refreshAll() {
    const [records, settings] = await Promise.all([
      storageManager.getRecordsList(),
      storageManager.getSettings()
    ]);

    state.allRecords = records;
    state.settings = settings;

    // Remove stale selected keys that no longer exist
    const existingKeys = new Set(records.map((r) => r.key));
    for (const key of Array.from(state.selectedKeys)) {
      if (!existingKeys.has(key)) state.selectedKeys.delete(key);
    }

    Actions.applyTheme(settings.theme);
    updateTrackingIndicator();

    const stats = Store.computeStatistics(records);
    updateKpisAndNav(stats);
    updateAccountFilterOptions(records);

    if (state.view === "stats") {
      renderStats();
    } else if (state.view === "settings") {
      populateSettingsForm();
    } else if (state.view === "deleted" || state.view === "all") {
      renderTable();
    }
  }

  async function consumeInitialViewHint() {
    const hashView = (window.location.hash || "").replace(/^#/, "").trim();
    if (VIEW_META[hashView]) {
      switchView(hashView);
      return;
    }

    try {
      const res = await api.storage.local.get(PENDING_VIEW_KEY);
      const pending = res?.[PENDING_VIEW_KEY];
      if (pending && VIEW_META[pending]) {
        await api.storage.local.remove?.(PENDING_VIEW_KEY);
        switchView(pending);
        return;
      }
    } catch (_err) {
      // Ignore if optional key is unavailable.
    }

    switchView("deleted");
  }

  function bindEvents() {
    els.sideNav.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-view]");
      if (!btn) return;
      switchView(btn.dataset.view);
    });

    els.statusPills.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-status]");
      if (!btn) return;
      state.status = btn.dataset.status || "all";
      state.page = 1;
      syncStatusPillsUI();
      renderTable();
    });

    els.searchInput.addEventListener("input", (event) => {
      state.search = event.target.value || "";
      state.page = 1;
      renderTable();
    });

    els.accountFilter.addEventListener("change", (event) => {
      state.accountId = event.target.value || "all";
      state.page = 1;
      renderTable();
    });

    els.sortSelect.addEventListener("change", (event) => {
      const [sortBy, sortDir] = String(event.target.value || "deletedAt:desc").split(":");
      state.sortBy = sortBy || "deletedAt";
      state.sortDir = sortDir === "asc" ? "asc" : "desc";
      state.page = 1;
      renderTable();
    });

    els.dateFieldSelect.addEventListener("change", (event) => {
      state.dateField = event.target.value === "receivedAt" ? "receivedAt" : "deletedAt";
      state.page = 1;
      renderTable();
    });

    els.dateFromInput.addEventListener("change", (event) => {
      state.dateFrom = event.target.value || "";
      state.page = 1;
      renderTable();
    });

    els.dateToInput.addEventListener("change", (event) => {
      state.dateTo = event.target.value || "";
      state.page = 1;
      renderTable();
    });

    els.btnResetFilters.addEventListener("click", () => {
      state.search = "";
      state.accountId = "all";
      state.dateField = "deletedAt";
      state.dateFrom = "";
      state.dateTo = "";
      state.page = 1;
      els.searchInput.value = "";
      els.accountFilter.value = "all";
      els.dateFieldSelect.value = "deletedAt";
      els.dateFromInput.value = "";
      els.dateToInput.value = "";
      renderTable();
    });

    for (const btn of document.querySelectorAll(".th-sort-btn")) {
      btn.addEventListener("click", () => {
        const col = btn.dataset.sort;
        if (state.sortBy === col) {
          state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        } else {
          state.sortBy = col;
          state.sortDir = col === "subject" || col === "author" ? "asc" : "desc";
        }
        state.page = 1;
        renderTable();
      });
    }

    els.selectAllPage.addEventListener("change", () => {
      const startIdx = (state.page - 1) * PAGE_SIZE;
      const pageItems = state.filteredRecords.slice(startIdx, startIdx + PAGE_SIZE);
      for (const rec of pageItems) {
        if (els.selectAllPage.checked) state.selectedKeys.add(rec.key);
        else state.selectedKeys.delete(rec.key);
      }
      renderTable();
    });

    els.btnBulkRestore.addEventListener("click", handleBulkRestore);
    els.btnBulkCsv.addEventListener("click", () => {
      const selected = state.allRecords.filter((r) => state.selectedKeys.has(r.key));
      exportCsv(selected, "secili");
    });
    els.btnBulkRemove.addEventListener("click", handleBulkRemove);
    els.btnBulkClear.addEventListener("click", () => {
      state.selectedKeys.clear();
      renderTable();
    });

    els.btnPrevPage.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
      }
    });

    els.btnNextPage.addEventListener("click", () => {
      state.page += 1;
      renderTable();
    });

    els.btnQuickScan.addEventListener("click", () => runFolderScan("inbox"));
    els.btnScanInboxes.addEventListener("click", () => runFolderScan("inbox"));
    els.btnScanTrash.addEventListener("click", () => runFolderScan("trash"));

    els.btnExportCsv.addEventListener("click", () => exportCsv(state.filteredRecords, "filtreli"));
    els.btnExportJson.addEventListener("click", exportJson);
    els.btnToolsCsvAll.addEventListener("click", () => exportCsv(state.allRecords, "tumu"));
    els.btnToolsJsonAll.addEventListener("click", exportJson);
    els.jsonImportInput.addEventListener("change", handleJsonImport);

    els.btnThemeCycle.addEventListener("click", async () => {
      const order = ["system", "light", "dark"];
      const nextTheme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
      state.settings = await storageManager.saveSettings({ theme: nextTheme });
      Actions.applyTheme(nextTheme);
      updateTrackingIndicator();
      if (state.view === "settings") populateSettingsForm();
    });

    els.settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.settings = await storageManager.saveSettings({
        trackIncoming: els.setTrackIncoming.checked,
        trackTrash: els.setTrackTrash.checked,
        trackPermanentDelete: els.setTrackPermanent.checked,
        showBadgeCount: els.setShowBadge.checked,
        maxRecords: Number(els.setMaxRecords.value) || Store.DEFAULT_MAX_RECORDS,
        theme: els.setTheme.value || "system"
      });
      Actions.applyTheme(state.settings.theme);
      updateTrackingIndicator();
      api.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
      showToast("Ayarlar kaydedildi.", "success");
    });

    els.btnClearTrigger.addEventListener("click", () => {
      els.clearConfirmBar.classList.toggle("hidden");
    });
    els.btnClearCancel.addEventListener("click", () => {
      els.clearConfirmBar.classList.add("hidden");
    });
    els.btnClearActive.addEventListener("click", async () => {
      await storageManager.clearRecords("active");
      els.clearConfirmBar.classList.add("hidden");
      showToast("Aktif mail kayıtları temizlendi; silinen kayıtlar korundu.");
    });
    els.btnClearAll.addEventListener("click", async () => {
      await storageManager.clearRecords("all");
      state.selectedKeys.clear();
      els.clearConfirmBar.classList.add("hidden");
      showToast("Tüm günlük temizlendi.");
    });

    els.btnDrawerClose.addEventListener("click", closeDetailDrawer);
    els.drawerBackdrop.addEventListener("click", closeDetailDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeDrawerKey) {
        closeDetailDrawer();
      }
    });

    if (api.storage?.onChanged) {
      api.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && (changes[Store.STORAGE_KEY] || changes[Store.SETTINGS_KEY])) {
          refreshAll().catch(console.error);
        }
      });
    }

    if (api.runtime?.onMessage) {
      api.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === "switchView" && VIEW_META[msg.view]) {
          switchView(msg.view);
        }
      });
    }
  }

  bindEvents();
  refreshAll()
    .then(consumeInitialViewHint)
    .catch((err) => {
      console.error("[MailAudit] İlk yükleme hatası:", err);
      showToast("Kayıtlar yüklenirken bir hata oluştu.", "error");
    });
})();
