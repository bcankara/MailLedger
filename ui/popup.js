(function initMailAuditPopup() {
  "use strict";

  const api = globalThis.messenger || globalThis.browser;
  const Store = globalThis.MailAuditStore;
  const Actions = globalThis.MailAuditActions;

  if (!api || !Store || !Actions) {
    return;
  }

  const MAX_POPUP_ITEMS = 8;
  const storageManager = Store.createStorageManager(api.storage.local);

  const els = {
    statTrashed: document.getElementById("stat-trashed"),
    statToday: document.getElementById("stat-today"),
    statTotal: document.getElementById("stat-total"),
    searchInput: document.getElementById("popup-search"),
    statusMsg: document.getElementById("popup-status-msg"),
    list: document.getElementById("popup-list"),
    empty: document.getElementById("popup-empty"),
    emptyText: document.getElementById("popup-empty-text"),
    btnOpenFullTop: document.getElementById("btn-open-full-top"),
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
    if (statusTimer) {
      clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
      els.statusMsg.classList.add("hidden");
    }, 3500);
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function render() {
    const stats = Store.computeStatistics(allRecords);
    els.statTrashed.textContent = String(stats.trashed);
    els.statToday.textContent = String(stats.deletedToday);
    els.statTotal.textContent = String(stats.total);

    const deletedList = Store.filterAndSortRecords(allRecords, {
      status: "deleted_any",
      search: searchQuery,
      sortBy: "deletedAt",
      sortDir: "desc"
    });

    const visible = deletedList.slice(0, MAX_POPUP_ITEMS);
    els.list.textContent = "";

    if (visible.length === 0) {
      els.empty.classList.remove("hidden");
      els.emptyText.textContent = searchQuery.trim()
        ? "Aramanızla eşleşen silinen mail bulunamadı."
        : "Henüz silinen mail kaydı yok. Bir maili sildiğinizde burada silinme tarihine göre anında görünür.";
      return;
    }

    els.empty.classList.add("hidden");

    for (const rec of visible) {
      const li = createEl("li", "popup-item");

      const topRow = createEl("div", "popup-item-top");
      topRow.appendChild(createEl("div", "popup-subject", rec.subject || "(Konu yok)"));
      const badgeCls = rec.status === "trashed" ? "popup-badge trashed" : "popup-badge deleted";
      topRow.appendChild(createEl("span", badgeCls, rec.status === "trashed" ? "Çöp" : "Kalıcı"));
      li.appendChild(topRow);

      li.appendChild(createEl("div", "popup-author", rec.author || "Gönderen bilinmiyor"));

      const datesRow = createEl("div", "popup-dates");
      const receivedSpan = document.createElement("span");
      receivedSpan.textContent = "Geliş: ";
      receivedSpan.appendChild(createEl("strong", "", Store.formatDateShortTR(rec.receivedAt)));

      const deletedSpan = document.createElement("span");
      deletedSpan.textContent = "Silinme: ";
      const deletedText = rec.deletedAt != null
        ? Store.formatDateShortTR(rec.deletedAt)
        : (rec.preExistingTrash ? "Kurulum öncesi" : "—");
      deletedSpan.appendChild(createEl("strong", "", deletedText));

      datesRow.appendChild(receivedSpan);
      datesRow.appendChild(deletedSpan);
      li.appendChild(datesRow);

      if (rec.status === "trashed") {
        const actionsRow = createEl("div", "popup-actions");

        const btnOpen = createEl("button", "btn btn-secondary btn-xs", "Aç");
        btnOpen.type = "button";
        btnOpen.addEventListener("click", async () => {
          const res = await Actions.openMessage(api, rec);
          if (!res.ok) {
            showStatus(res.error, true);
          } else {
            window.close();
          }
        });

        const btnRestore = createEl("button", "btn btn-primary btn-xs", "Geri Yükle");
        btnRestore.type = "button";
        btnRestore.addEventListener("click", async () => {
          const res = await Actions.restoreMessage(api, Store, rec);
          if (!res.ok) {
            showStatus(res.error, true);
          } else {
            showStatus("Mail orijinal klasörüne geri yüklendi.");
          }
        });

        actionsRow.appendChild(btnOpen);
        actionsRow.appendChild(btnRestore);
        li.appendChild(actionsRow);
      }

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
    Actions.applyTheme(settings.theme);
    allRecords = records;
    render();
  }

  els.searchInput.addEventListener("input", (event) => {
    searchQuery = event.target.value || "";
    render();
  });

  els.btnOpenFullTop.addEventListener("click", () => openDashboardView("deleted"));
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
    console.error("[MailAudit] Popup yükleme hatası:", err);
    showStatus("Veriler yüklenemedi.", true);
  });
})();
