(function initMailAuditOptions() {
  "use strict";

  const api = globalThis.messenger || globalThis.browser;
  const Store = globalThis.MailAuditStore;
  const Actions = globalThis.MailAuditActions;

  if (!api || !Store || !Actions) {
    return;
  }

  const storageManager = Store.createStorageManager(api.storage.local);

  const els = {
    form: document.getElementById("options-form"),
    trackIncoming: document.getElementById("opt-track-incoming"),
    trackTrash: document.getElementById("opt-track-trash"),
    trackPermanent: document.getElementById("opt-track-permanent"),
    showBadge: document.getElementById("opt-show-badge"),
    maxRecords: document.getElementById("opt-max-records"),
    theme: document.getElementById("opt-theme"),
    status: document.getElementById("opt-status"),
    btnOpenDashboard: document.getElementById("opt-open-dashboard")
  };

  async function loadSettings() {
    const s = await storageManager.getSettings();
    els.trackIncoming.checked = Boolean(s.trackIncoming);
    els.trackTrash.checked = Boolean(s.trackTrash);
    els.trackPermanent.checked = Boolean(s.trackPermanentDelete);
    els.showBadge.checked = Boolean(s.showBadgeCount);
    els.maxRecords.value = String(s.maxRecords || Store.DEFAULT_MAX_RECORDS);
    els.theme.value = s.theme || "system";
    Actions.applyTheme(s.theme);
  }

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const updated = await storageManager.saveSettings({
      trackIncoming: els.trackIncoming.checked,
      trackTrash: els.trackTrash.checked,
      trackPermanentDelete: els.trackPermanent.checked,
      showBadgeCount: els.showBadge.checked,
      maxRecords: Number(els.maxRecords.value) || Store.DEFAULT_MAX_RECORDS,
      theme: els.theme.value || "system"
    });
    Actions.applyTheme(updated.theme);
    api.runtime.sendMessage({ type: "refreshBadge" }).catch(() => {});
    els.status.textContent = "Ayarlar kaydedildi.";
    setTimeout(() => {
      els.status.textContent = "";
    }, 3000);
  });

  els.btnOpenDashboard.addEventListener("click", async () => {
    try {
      await api.runtime.sendMessage({ type: "openDashboard", view: "deleted" });
    } catch (_err) {
      await api.tabs.create({ url: api.runtime.getURL("ui/dashboard.html") });
    }
  });

  loadSettings().catch(console.error);
})();
