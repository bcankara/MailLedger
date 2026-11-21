(function initMailAuditDashboard() {
  "use strict";

  const api = globalThis.messenger || globalThis.browser;
  const I18n = globalThis.MailAuditI18n;
  const Store = globalThis.MailAuditStore;
  const Actions = globalThis.MailAuditActions;

  if (!api || !I18n || !Store || !Actions) {
    return;
  }

  const PAGE_SIZE = 50;
  const PENDING_VIEW_KEY = "mailAuditPendingView";

  const VIEW_TITLE_KEYS = {
    deleted: "viewDeletedTitle",
    all: "viewAllTitle",
    stats: "viewStatsTitle",
    tools: "viewToolsTitle",
    settings: "viewSettingsTitle"
  };

  const storageManager = Store.createStorageManager(api.storage.local);
  const i18n = I18n.createI18n(api);

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
    inlineMetrics: document.getElementById("inline-metrics"),
    logHeaderActions: document.getElementById("log-header-actions"),
    scanStatusBar: document.getElementById("scan-status-bar"),

    viewLog: document.getElementById("view-log"),
    viewStats: document.getElementById("view-stats"),
    viewTools: document.getElementById("view-tools"),
    viewSettings: document.getElementById("view-settings"),

    kpiTotal: document.getElementById("kpi-total"),
    kpiTrashed: document.getElementById("kpi-trashed"),
    kpiDeleted: document.getElementById("kpi-deleted"),
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
    setLanguage: document.getElementById("set-language"),
    setMaxRecords: document.getElementById("set-max-records"),
    setTheme: document.getElementById("set-theme"),

    btnClearTrigger: document.getElementById("btn-clear-trigger"),
    clearConfirmBar: document.getElementById("clear-confirm-bar"),
    btnClearActive: document.getElementById("btn-clear-active"),
    btnClearAll: document.getElementById("btn-clear-all"),
    btnClearCancel: document.getElementById("btn-clear-cancel"),

    detailDrawer: document.getElementById("detail-drawer"),
    splitWorkspace: document.querySelector(".split-workspace"),
    drawerSubject: document.getElementById("drawer-subject"),
    drawerStatusLine: document.getElementById("drawer-status-line"),
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
    setTimeout(() => toast.remove(), 3800);
  }

  function localizeActionError(res) {
    if (res.errorCode === "NOT_FOUND") return i18n.t("errMsgNotFound");
    if (res.errorCode === "TRASH_NOT_FOUND") return i18n.t("errTrashMsgNotFound");
    if (res.errorCode === "NO_INBOX") return i18n.t("errNoInboxFound");
    return res.error || i18n.t("toastRestoreFailed");
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function themeButtonText(theme) {
    if (theme === "dark") return i18n.t("themeBtnDark");
    if (theme === "light") return i18n.t("themeBtnLight");
    return i18n.t("themeBtnSystem");
  }

  function getStatusLabel(status) {
    if (status === "trashed") return i18n.t("statusTrashed");
    if (status === "deleted") return i18n.t("statusDeleted");
    return i18n.t("statusActive");
  }

  function buildStatusNode(status) {
    const wrap = createEl("span", "state-cell");
    wrap.appendChild(createEl("span", `state-dot ${status || "active"}`));
    wrap.appendChild(document.createTextNode(getStatusLabel(status)));
    return wrap;
  }

  function formatDeletedDateDisplay(rec) {
    if (rec.deletedAt != null) {
      return Store.formatDateShort(rec.deletedAt, i18n.getLocale());
    }
    if (rec.preExistingTrash) {
      return i18n.t("preExistingTrash");
    }
    return "—";
  }

  function buildFolderDisplay(rec) {
    if (rec.status === "trashed") {
      if (rec.originalFolderPath && rec.currentFolderPath) {
        return `${rec.originalFolderPath} → ${rec.currentFolderPath}`;
      }
      return rec.currentFolderPath || rec.originalFolderPath || i18n.t("folderTrashFallback");
    }
    if (rec.status === "deleted") {
      return rec.originalFolderPath
        ? i18n.t("folderFormerPrefix", rec.originalFolderPath)
        : i18n.t("folderRemovedFromServer");
    }
    return rec.currentFolderPath || rec.originalFolderPath || "—";
  }

  function syncStatusPillsUI() {
    for (const pill of els.statusPills.querySelectorAll(".seg-btn")) {
      pill.classList.toggle("active", pill.dataset.status === state.status);
    }
  }

  function syncSortHeadersUI() {
    const keyMap = {
      status: "colStatus",
      subject: "colSubjectAuthor",
      receivedAt: "colReceivedDate",
      deletedAt: "colDeletedDate"
    };
    for (const btn of document.querySelectorAll(".th-sort")) {
      const col = btn.dataset.sort;
      const arrow = state.sortBy === col ? (state.sortDir === "asc" ? " ↑" : " ↓") : "";
      btn.textContent = `${i18n.t(keyMap[col] || col)}${arrow}`;
    }
    const combo = `${state.sortBy}:${state.sortDir}`;
    if (Array.from(els.sortSelect.options).some((o) => o.value === combo)) {
      els.sortSelect.value = combo;
    }
  }

  function switchView(targetView) {
    const valid = VIEW_TITLE_KEYS[targetView] ? targetView : "deleted";
    state.view = valid;

    for (const btn of els.sideNav.querySelectorAll(".nav-link")) {
      btn.classList.toggle("active", btn.dataset.view === valid);
    }

    els.viewTitle.textContent = i18n.t(VIEW_TITLE_KEYS[valid]);

    const isLogView = valid === "deleted" || valid === "all";
    els.logHeaderActions.classList.toggle("hidden", !isLogView);
    els.inlineMetrics.classList.toggle("hidden", !isLogView);
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
      state.sortBy = "activity";
      state.sortDir = "desc";
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
    els.trackingText.textContent = anyOn ? i18n.t("trackingActive") : i18n.t("trackingPaused");
    els.btnThemeCycle.textContent = themeButtonText(state.settings.theme);
  }

  function updateMetricsAndNav(stats) {
    els.kpiTotal.textContent = String(stats.total);
    els.kpiTrashed.textContent = String(stats.trashed);
    els.kpiDeleted.textContent = String(stats.deleted);
    els.kpiToday.textContent = String(stats.deletedToday);

    els.navCountDeleted.textContent = String(stats.deletedAny);
    els.navCountAll.textContent = String(stats.total);
  }

  function updateAccountFilterOptions(records) {
    const previous = state.accountId;
    const accountsMap = new Map();
    const locale = i18n.getLocale();

    for (const rec of records) {
      if (rec.accountId && !accountsMap.has(rec.accountId)) {
        accountsMap.set(rec.accountId, rec.accountName || rec.accountId);
      }
    }

    els.accountFilter.textContent = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = i18n.t("allAccounts");
    els.accountFilter.appendChild(allOpt);

    const sortedEntries = Array.from(accountsMap.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], locale, { sensitivity: "base" })
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
    els.bulkSelectedText.textContent = i18n.t("bulkSelectedCount", count);

    const hasTrashedSelected = state.allRecords.some(
      (r) => state.selectedKeys.has(r.key) && r.status === "trashed"
    );
    els.btnBulkRestore.disabled = !hasTrashedSelected;

    const allOnPageSelected = pageItems.length > 0 && pageItems.every((r) => state.selectedKeys.has(r.key));
    els.selectAllPage.checked = allOnPageSelected;
  }

  function renderTable() {
    syncSortHeadersUI();
    const locale = i18n.getLocale();

    state.filteredRecords = Store.filterAndSortRecords(state.allRecords, {
      search: state.search,
      status: state.status,
      accountId: state.accountId,
      dateField: state.dateField,
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      locale
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
        ? i18n.t("emptyFiltered")
        : i18n.t("emptyInitial");
      els.paginationSummary.textContent = i18n.t("paginationZero");
    } else {
      els.emptyState.classList.add("hidden");
      const endIdx = Math.min(startIdx + pageItems.length, total);
      els.paginationSummary.textContent = i18n.t("paginationRange", [startIdx + 1, endIdx, total]);
    }

    els.paginationPage.textContent = i18n.t("paginationPage", [state.page, totalPages]);
    els.btnPrevPage.disabled = state.page <= 1;
    els.btnNextPage.disabled = state.page >= totalPages;

    for (const rec of pageItems) {
      const tr = document.createElement("tr");
      if (state.activeDrawerKey === rec.key) {
        tr.classList.add("selected-row");
      }

      tr.addEventListener("click", (event) => {
        if (event.target.closest("input, button")) return;
        openDetailDrawer(rec);
      });

      // Checkbox
      const tdCheck = createEl("td", "col-check");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.selectedKeys.has(rec.key);
      cb.setAttribute("aria-label", rec.subject || i18n.t("noSubject"));
      cb.addEventListener("change", () => {
        if (cb.checked) state.selectedKeys.add(rec.key);
        else state.selectedKeys.delete(rec.key);
        updateBulkBar(pageItems);
      });
      tdCheck.appendChild(cb);
      tr.appendChild(tdCheck);

      // State
      const tdState = createEl("td", "col-state");
      tdState.appendChild(buildStatusNode(rec.status));
      tr.appendChild(tdState);

      // Message
      const tdMsg = createEl("td", "col-msg");
      tdMsg.appendChild(createEl("div", "cell-primary", rec.subject || i18n.t("noSubject")));
      tdMsg.appendChild(createEl("div", "cell-secondary", rec.author || i18n.t("unknownSender")));
      tr.appendChild(tdMsg);

      // Location
      const tdLoc = createEl("td", "col-loc");
      tdLoc.appendChild(createEl("div", "cell-primary", rec.accountName || rec.accountId || "—"));
      tdLoc.appendChild(createEl("div", "cell-secondary", buildFolderDisplay(rec)));
      tr.appendChild(tdLoc);

      // Received
      const tdRecv = createEl("td", "col-date");
      tdRecv.appendChild(createEl("div", "date-text", Store.formatDateShort(rec.receivedAt, locale)));
      tr.appendChild(tdRecv);

      // Deleted
      const tdDel = createEl("td", "col-date");
      tdDel.appendChild(createEl("div", "date-text", formatDeletedDateDisplay(rec)));
      if (rec.permanentlyDeletedAt) {
        tdDel.appendChild(
          createEl("div", "date-sub", i18n.t("subDatePermanent", Store.formatDateShort(rec.permanentlyDeletedAt, locale)))
        );
      } else if (rec.restoredAt) {
        tdDel.appendChild(
          createEl("div", "date-sub", i18n.t("subDateRestored", Store.formatDateShort(rec.restoredAt, locale)))
        );
      }
      tr.appendChild(tdDel);

      // Actions
      const tdAct = createEl("td", "col-act");
      const acts = createEl("div", "row-acts");
      if (rec.status !== "deleted") {
        const btnOpen = createEl("button", "btn btn-subtle btn-xs", i18n.t("btnOpen"));
        btnOpen.type = "button";
        btnOpen.addEventListener("click", () => handleOpenMessage(rec));
        acts.appendChild(btnOpen);
      }
      if (rec.status === "trashed") {
        const btnRestore = createEl("button", "btn btn-primary btn-xs", i18n.t("btnRestore"));
        btnRestore.type = "button";
        btnRestore.addEventListener("click", () => handleRestoreMessage(rec));
        acts.appendChild(btnRestore);
      }
      tdAct.appendChild(acts);
      tr.appendChild(tdAct);

      els.tbody.appendChild(tr);
    }

    updateBulkBar(pageItems);
  }

  function renderStats() {
    const stats = Store.computeStatistics(state.allRecords, Date.now(), {
      unknownFolderLabel: i18n.t("unknownFolder")
    });

    els.dailyChart.textContent = "";
    const maxDay = Math.max(1, ...stats.dailyDeletions.map((d) => d.count));
    for (const day of stats.dailyDeletions) {
      const col = createEl("div", "bar-col");
      col.appendChild(createEl("span", "bar-num", day.count > 0 ? String(day.count) : ""));
      const rail = createEl("div", "bar-rail");
      const fill = createEl("div", "bar-fill");
      const pct = day.count > 0 ? Math.max(6, Math.round((day.count / maxDay) * 100)) : 0;
      fill.style.height = `${pct}%`;
      rail.appendChild(fill);
      col.appendChild(rail);
      col.appendChild(createEl("span", "bar-day", day.label));
      els.dailyChart.appendChild(col);
    }

    els.accountStatsList.textContent = "";
    if (stats.byAccount.length === 0) {
      els.accountStatsList.appendChild(createEl("p", "footnote", i18n.t("statsNoAccountData")));
    } else {
      const maxAcc = Math.max(1, stats.byAccount[0].total);
      for (const acc of stats.byAccount) {
        const row = createEl("div", "breakdown-row");
        const top = createEl("div", "breakdown-top");
        top.appendChild(createEl("strong", "", acc.accountName));
        top.appendChild(createEl("span", "", i18n.t("statsAccountRecords", acc.total)));
        row.appendChild(top);
        row.appendChild(
          createEl("div", "breakdown-sub", i18n.t("statsAccountBreakdown", [acc.active, acc.trashed, acc.deleted]))
        );
        const bar = createEl("div", "bar-horiz");
        const fill = document.createElement("div");
        fill.style.width = `${Math.round((acc.total / maxAcc) * 100)}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
        els.accountStatsList.appendChild(row);
      }
    }

    els.folderStatsList.textContent = "";
    if (stats.topDeletedFolders.length === 0) {
      els.folderStatsList.appendChild(createEl("p", "footnote", i18n.t("statsNoFolderData")));
    } else {
      const maxFolder = Math.max(1, stats.topDeletedFolders[0].count);
      for (const item of stats.topDeletedFolders) {
        const row = createEl("div", "breakdown-row");
        const top = createEl("div", "breakdown-top");
        top.appendChild(createEl("strong", "", item.folder));
        top.appendChild(createEl("span", "", i18n.t("statsFolderDeletedCount", item.count)));
        row.appendChild(top);
        const bar = createEl("div", "bar-horiz");
        const fill = document.createElement("div");
        fill.style.width = `${Math.round((item.count / maxFolder) * 100)}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
        els.folderStatsList.appendChild(row);
      }
    }
  }

  function openDetailDrawer(rec) {
    const locale = i18n.getLocale();
    state.activeDrawerKey = rec.key;
    els.drawerSubject.textContent = rec.subject || i18n.t("noSubject");
    els.drawerStatusLine.textContent = "";
    els.drawerStatusLine.appendChild(buildStatusNode(rec.status));
    els.drawerBody.textContent = "";
    els.drawerFooter.textContent = "";

    const rows = [
      { label: i18n.t("detailSender"), text: rec.author || "—" },
      { label: i18n.t("detailAccount"), text: rec.accountName || rec.accountId || "—" },
      { label: i18n.t("detailOrigFolder"), text: rec.originalFolderPath || "—" },
      { label: i18n.t("detailCurrFolder"), text: rec.currentFolderPath || "—" },
      { label: i18n.t("detailReceivedAt"), text: Store.formatDate(rec.receivedAt, locale) },
      { label: i18n.t("detailDeletedAt"), text: rec.deletedAt != null ? Store.formatDate(rec.deletedAt, locale) : formatDeletedDateDisplay(rec) },
      { label: i18n.t("detailPermDeletedAt"), text: Store.formatDate(rec.permanentlyDeletedAt, locale) },
      { label: i18n.t("detailRestoredAt"), text: Store.formatDate(rec.restoredAt, locale) },
      { label: i18n.t("detailRecordedAt"), text: Store.formatDate(rec.recordedAt, locale) }
    ];

    for (const item of rows) {
      const wrap = createEl("div", "kv-row");
      wrap.appendChild(createEl("span", "kv-label", item.label));
      wrap.appendChild(createEl("span", "kv-val", item.text));
      els.drawerBody.appendChild(wrap);
    }

    if (rec.headerMessageId) {
      const idWrap = createEl("div", "kv-row");
      idWrap.appendChild(createEl("span", "kv-label", "Message-ID"));
      const box = createEl("div", "mono-box");
      box.appendChild(createEl("code", "", rec.headerMessageId));
      const copyBtn = createEl("button", "btn btn-ghost btn-xs", i18n.t("btnCopyMessageId"));
      copyBtn.type = "button";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(rec.headerMessageId);
          showToast(i18n.t("toastCopiedId"));
        } catch (_err) {
          showToast(i18n.t("toastCopyFailed"), "error");
        }
      });
      box.appendChild(copyBtn);
      idWrap.appendChild(box);
      els.drawerBody.appendChild(idWrap);
    }

    if (rec.status !== "deleted") {
      const btnOpen = createEl("button", "btn btn-subtle btn-sm", i18n.t("btnOpenInThunderbird"));
      btnOpen.type = "button";
      btnOpen.addEventListener("click", () => handleOpenMessage(rec));
      els.drawerFooter.appendChild(btnOpen);
    }

    if (rec.status === "trashed") {
      const btnRestore = createEl("button", "btn btn-primary btn-sm", i18n.t("btnRestoreOriginal"));
      btnRestore.type = "button";
      btnRestore.addEventListener("click", async () => {
        await handleRestoreMessage(rec);
        closeDetailDrawer();
      });
      els.drawerFooter.appendChild(btnRestore);
    }

    const btnDel = createEl("button", "btn btn-danger-ghost btn-sm", i18n.t("btnRemoveFromLog"));
    btnDel.type = "button";
    btnDel.addEventListener("click", async () => {
      await handleRemoveRecord(rec);
      closeDetailDrawer();
    });
    els.drawerFooter.appendChild(btnDel);

    els.detailDrawer.classList.remove("hidden");
    els.splitWorkspace?.classList.add("has-inspector");
    renderTable();
  }

  function closeDetailDrawer() {
    state.activeDrawerKey = null;
    els.detailDrawer.classList.add("hidden");
    els.splitWorkspace?.classList.remove("has-inspector");
    renderTable();
  }

  function populateSettingsForm() {
    const s = state.settings;
    els.setTrackIncoming.checked = Boolean(s.trackIncoming);
    els.setTrackTrash.checked = Boolean(s.trackTrash);
    els.setTrackPermanent.checked = Boolean(s.trackPermanentDelete);
    els.setShowBadge.checked = Boolean(s.showBadgeCount);
    els.setLanguage.value = s.language || "auto";
    els.setMaxRecords.value = String(s.maxRecords || Store.DEFAULT_MAX_RECORDS);
    els.setTheme.value = s.theme || "system";
  }

  async function handleOpenMessage(rec) {
    try {
      const res = await Actions.openMessage(api, rec);
      if (!res.ok) showToast(localizeActionError(res), "error");
    } catch (err) {
      console.error("[MailLedger] Open error:", err);
      showToast(i18n.t("toastOpenFailed"), "error");
    }
  }

  async function handleRestoreMessage(rec) {
    try {
      const res = await Actions.restoreMessage(api, Store, rec);
      if (!res.ok) {
        showToast(localizeActionError(res), "error");
        return;
      }
      showToast(i18n.t("toastRestored"), "success");
    } catch (err) {
      console.error("[MailLedger] Restore error:", err);
      showToast(i18n.t("toastRestoreFailed"), "error");
    }
  }

  async function handleRemoveRecord(rec) {
    try {
      state.selectedKeys.delete(rec.key);
      await storageManager.removeRecord(rec.key);
      showToast(i18n.t("toastRemoved"));
    } catch (err) {
      console.error("[MailLedger] Remove error:", err);
      showToast(i18n.t("toastRemoveFailed"), "error");
    }
  }

  async function handleBulkRestore() {
    const selectedTrashed = state.allRecords.filter(
      (r) => state.selectedKeys.has(r.key) && r.status === "trashed"
    );
    if (selectedTrashed.length === 0) return;

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
      showToast(i18n.t("toastBulkRestoredOk", okCount), "success");
    } else {
      showToast(i18n.t("toastBulkRestoredPartial", [okCount, failCount]), "error");
    }
  }

  async function handleBulkRemove() {
    const keys = Array.from(state.selectedKeys);
    if (keys.length === 0) return;
    await storageManager.removeRecordsBulk(keys);
    state.selectedKeys.clear();
    showToast(i18n.t("toastBulkRemoved", keys.length));
  }

  async function runFolderScan(specialUse) {
    if (state.scanning) return;
    state.scanning = true;
    els.btnQuickScan.disabled = true;
    els.btnScanInboxes.disabled = true;
    els.btnScanTrash.disabled = true;
    els.scanStatusBar.classList.remove("hidden");

    const maxKeep = Number(els.scanLimitSelect.value) || 500;
    els.scanStatusBar.textContent = specialUse === "trash"
      ? i18n.t("toastScanningTrash")
      : i18n.t("toastScanningInboxes");

    try {
      const res = await Actions.scanFoldersByUse(api, Store, storageManager, {
        specialUse,
        maxKeep,
        onProgress: ({ index, total, accountName, folderName }) => {
          els.scanStatusBar.textContent = i18n.t("toastScanningProgress", [
            index,
            total,
            accountName,
            folderName
          ]);
        }
      });
      showToast(i18n.t("toastScanDone", [res.folderCount, res.messageCount]), "success");
    } catch (err) {
      console.error("[MailLedger] Scan error:", err);
      showToast(i18n.t("toastScanFailed"), "error");
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
    const csv = Store.exportRecordsToCsv(records, {
      locale: i18n.getLocale(),
      labels: i18n.buildCsvLabels()
    });
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(`mailledger-${suffix}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
    showToast(i18n.t("toastCsvExported", records.length));
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: "1.2.0",
      records: state.allRecords
    };
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(
      `mailledger-backup-${stamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    showToast(i18n.t("toastJsonExported", state.allRecords.length));
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
        i18n.t("toastImportDone", [summary.importedCount, summary.updatedCount, summary.skippedCount]),
        "success"
      );
    } catch (err) {
      console.error("[MailLedger] Import error:", err);
      showToast(i18n.t("toastImportFailed"), "error");
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

    const existingKeys = new Set(records.map((r) => r.key));
    for (const key of Array.from(state.selectedKeys)) {
      if (!existingKeys.has(key)) state.selectedKeys.delete(key);
    }

    await i18n.setPreference(settings.language);
    i18n.applyDom(document);
    Actions.applyTheme(settings.theme);
    updateTrackingIndicator();

    els.viewTitle.textContent = i18n.t(VIEW_TITLE_KEYS[state.view] || "viewDeletedTitle");

    const stats = Store.computeStatistics(records, Date.now(), {
      unknownFolderLabel: i18n.t("unknownFolder")
    });
    updateMetricsAndNav(stats);
    updateAccountFilterOptions(records);

    if (state.view === "stats") {
      renderStats();
    } else if (state.view === "settings") {
      populateSettingsForm();
    } else if (state.view === "deleted" || state.view === "all") {
      renderTable();
      if (state.activeDrawerKey) {
        const live = records.find((r) => r.key === state.activeDrawerKey);
        if (live) openDetailDrawer(live);
        else closeDetailDrawer();
      }
    }
  }

  async function consumeInitialViewHint() {
    const hashView = (window.location.hash || "").replace(/^#/, "").trim();
    if (VIEW_TITLE_KEYS[hashView]) {
      switchView(hashView);
      return;
    }

    try {
      const res = await api.storage.local.get(PENDING_VIEW_KEY);
      const pending = res?.[PENDING_VIEW_KEY];
      if (pending && VIEW_TITLE_KEYS[pending]) {
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

    for (const btn of document.querySelectorAll(".th-sort")) {
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
      exportCsv(selected, "selected");
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

    els.btnExportCsv.addEventListener("click", () => exportCsv(state.filteredRecords, "filtered"));
    els.btnExportJson.addEventListener("click", exportJson);
    els.btnToolsCsvAll.addEventListener("click", () => exportCsv(state.allRecords, "all"));
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
        language: els.setLanguage.value || "auto",
        maxRecords: Number(els.setMaxRecords.value) || Store.DEFAULT_MAX_RECORDS,
        theme: els.setTheme.value || "system"
      });
      await refreshAll();
      api.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
      showToast(i18n.t("toastSaved"), "success");
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
      showToast(i18n.t("toastClearedActive"));
    });
    els.btnClearAll.addEventListener("click", async () => {
      await storageManager.clearRecords("all");
      state.selectedKeys.clear();
      els.clearConfirmBar.classList.add("hidden");
      showToast(i18n.t("toastClearedAll"));
    });

    els.btnDrawerClose.addEventListener("click", closeDetailDrawer);
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
        if (msg && msg.type === "switchView" && VIEW_TITLE_KEYS[msg.view]) {
          switchView(msg.view);
        }
      });
    }
  }

  bindEvents();
  refreshAll()
    .then(consumeInitialViewHint)
    .catch((err) => {
      console.error("[MailLedger] Initial load error:", err);
      showToast(i18n.t("toastLoadError"), "error");
    });
})();
