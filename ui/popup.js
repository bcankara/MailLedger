(function initMailAuditPopup() {
  "use strict";

  const api = globalThis.messenger || globalThis.browser;
  const I18n = globalThis.MailAuditI18n;
  const Store = globalThis.MailAuditStore;
  const Actions = globalThis.MailAuditActions;

  if (!api || !I18n || !Store || !Actions) {
    return;
  }

  const MAX_POPUP_ITEMS = 8;
  const storageManager = Store.createStorageManager(api.storage.local);
  const i18n = I18n.createI18n(api);

  const els = {
    metrics: document.getElementById("popup-metrics"),
    searchInput: document.getElementById("popup-search"),
    statusMsg: document.getElementById("popup-status-msg"),
    list: document.getElementById("popup-list"),
    empty: document.getElementById("popup-empty"),
    emptyText: document.getElementById("popup-empty-text"),
    btnOpenDashboard: document.getElementById("btn-open-dashboard"),
    btnOpenSettings: document.getElementById("btn-open-settings")
  };

  let allRecords = [];
  let searchQuery = "";
  let statusTimer = null;

  function showStatus(text, isError = false) {
    els.statusMsg.textContent = text;
    els.statusMsg.classList.remove("hidden");
    els.statusMsg.classList.toggle("is-error", Boolean(isError));
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => els.statusMsg.classList.add("hidden"), 3500);
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

  function render() {
    const locale = i18n.getLocale();
    const stats = Store.computeStatistics(allRecords, Date.now(), {
      unknownFolderLabel: i18n.t("unknownFolder")
    });

    els.metrics.textContent = i18n.t("popupStatSummary", [
      stats.trashed,
      stats.deletedToday,
      stats.total
    ]);

    const deletedList = Store.filterAndSortRecords(allRecords, {
      status: "deleted_any",
      search: searchQuery,
      sortBy: "deletedAt",
      sortDir: "desc",
      locale
    });

    const visible = deletedList.slice(0, MAX_POPUP_ITEMS);
    els.list.textContent = "";

    if (visible.length === 0) {
      els.empty.classList.remove("hidden");
      els.emptyText.textContent = searchQuery.trim()
        ? i18n.t("popupEmptySearch")
        : i18n.t("popupEmptyDefault");
      return;
    }

    els.empty.classList.add("hidden");

    for (const rec of visible) {
      const li = createEl("li", "mail-row");

      const head = createEl("div", "row-head");
      const subjWrap = createEl("div", "subject-wrap");
      const dot = createEl("span", rec.status === "deleted" ? "state-dot purged" : "state-dot");
      dot.title = rec.status === "deleted" ? i18n.t("statusDeleted") : i18n.t("statusTrashed");
      subjWrap.appendChild(dot);
      subjWrap.appendChild(createEl("span", "row-subject", rec.subject || i18n.t("noSubject")));
      head.appendChild(subjWrap);

      if (rec.status === "trashed") {
        const actions = createEl("div", "row-actions");

        const btnOpen = createEl("button", "btn btn-inline", i18n.t("btnOpen"));
        btnOpen.type = "button";
        btnOpen.addEventListener("click", async () => {
          const res = await Actions.openMessage(api, rec);
          if (!res.ok) showStatus(localizeActionError(res), true);
          else window.close();
        });

        const btnRestore = createEl("button", "btn btn-inline accent", i18n.t("btnRestore"));
        btnRestore.type = "button";
        btnRestore.addEventListener("click", async () => {
          const res = await Actions.restoreMessage(api, Store, rec);
          if (!res.ok) showStatus(localizeActionError(res), true);
          else showStatus(i18n.t("toastRestored"));
        });

        actions.appendChild(btnOpen);
        actions.appendChild(btnRestore);
        head.appendChild(actions);
      }

      li.appendChild(head);
      li.appendChild(createEl("div", "row-sub", rec.author || i18n.t("unknownSender")));

      const times = createEl("div", "row-times");
      const recv = document.createElement("span");
      recv.textContent = `${i18n.t("popupReceivedPrefix")} `;
      recv.appendChild(createEl("strong", "", Store.formatDateShort(rec.receivedAt, locale)));

      const del = document.createElement("span");
      del.textContent = `${i18n.t("popupDeletedPrefix")} `;
      const deletedText = rec.deletedAt != null
        ? Store.formatDateShort(rec.deletedAt, locale)
        : (rec.preExistingTrash ? i18n.t("preExistingTrash") : "—");
      del.appendChild(createEl("strong", "", deletedText));

      times.appendChild(recv);
      times.appendChild(del);
      li.appendChild(times);

      els.list.appendChild(li);
    }
  }

  async function openDashboardView(view) {
    try {
      await api.runtime.sendMessage({ type: "openDashboard", view });
      window.close();
    } catch (_err) {
      const base = api.runtime.getURL("ui/dashboard.html");
      await api.tabs.create({ url: view ? `${base}#${view}` : base });
      window.close();
    }
  }

  async function loadData() {
    const [records, settings] = await Promise.all([
      storageManager.getRecordsList(),
      storageManager.getSettings()
    ]);
    await i18n.setPreference(settings.language);
    i18n.applyDom(document);
    Actions.applyTheme(settings.theme);
    allRecords = records;
    render();
  }

  els.searchInput.addEventListener("input", (event) => {
    searchQuery = event.target.value || "";
    render();
  });

  els.btnOpenDashboard.addEventListener("click", () => openDashboardView("deleted"));
  els.btnOpenSettings.addEventListener("click", () => openDashboardView("settings"));

  if (api.storage?.onChanged) {
    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && (changes[Store.STORAGE_KEY] || changes[Store.SETTINGS_KEY])) {
        loadData().catch(console.error);
      }
    });
  }

  loadData().catch((err) => {
    console.error("[MailLedger] Popup load error:", err);
    showStatus(i18n.t("toastLoadError"), true);
  });
})();
