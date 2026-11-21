(function initMailAuditBackground(root) {
  "use strict";

  const SPACE_NAME = "mail_tarihce_gunlugu";
  const DASHBOARD_PATH = "ui/dashboard.html";
  const PENDING_VIEW_KEY = "mailAuditPendingView";

  const api = root.messenger || root.browser || null;
  const Store = root.MailAuditStore || (typeof require === "function" ? require("./store.js") : null);

  if (!api || !Store) {
    return;
  }

  const storageManager = Store.createStorageManager(api.storage.local);

  /**
   * Drain all paginated pages of a Thunderbird MessageList.
   * @param {{ id?: string|null, messages?: Array<object> }|null|undefined} initialPage
   * @returns {Promise<Array<object>>}
   */
  async function collectMessageList(initialPage) {
    if (!initialPage) {
      return [];
    }
    const collected = Array.isArray(initialPage.messages)
      ? [...initialPage.messages]
      : [];

    let page = initialPage;
    while (page && page.id) {
      page = await api.messages.continueList(page.id);
      if (page && Array.isArray(page.messages)) {
        collected.push(...page.messages);
      }
    }
    return collected;
  }

  /**
   * Pair pre-move and post-move MessageHeader lists reliably even when reordered.
   * @param {Array<object>} originalList
   * @param {Array<object>} movedList
   * @returns {Array<{ originalMsg: object|null, movedMsg: object|null }>}
   */
  function pairMovedMessages(originalList, movedList) {
    const originals = Array.isArray(originalList) ? originalList : [];
    const moved = Array.isArray(movedList) ? movedList : [];

    if (originals.length === 0) {
      return moved.map((movedMsg) => ({ originalMsg: null, movedMsg }));
    }
    if (moved.length === 0) {
      return originals.map((originalMsg) => ({ originalMsg, movedMsg: null }));
    }

    const byHeaderId = new Map();
    originals.forEach((msg, idx) => {
      const hid = typeof msg?.headerMessageId === "string" ? msg.headerMessageId.trim() : "";
      if (hid) {
        if (!byHeaderId.has(hid)) {
          byHeaderId.set(hid, []);
        }
        byHeaderId.get(hid).push(idx);
      }
    });

    const used = new Set();
    const pairs = new Array(moved.length);
    const sameLength = originals.length === moved.length;

    for (let i = 0; i < moved.length; i += 1) {
      const movedMsg = moved[i];
      const movedHid = typeof movedMsg?.headerMessageId === "string"
        ? movedMsg.headerMessageId.trim()
        : "";

      if (sameLength && !used.has(i)) {
        const origHid = typeof originals[i]?.headerMessageId === "string"
          ? originals[i].headerMessageId.trim()
          : "";
        if (!movedHid || !origHid || movedHid === origHid) {
          used.add(i);
          pairs[i] = { originalMsg: originals[i], movedMsg };
          continue;
        }
      }

      if (movedHid && byHeaderId.has(movedHid)) {
        const candidates = byHeaderId.get(movedHid);
        const matchIdx = candidates.find((idx) => !used.has(idx));
        if (matchIdx !== undefined) {
          used.add(matchIdx);
          pairs[i] = { originalMsg: originals[matchIdx], movedMsg };
        }
      }
    }

    let nextUnused = 0;
    for (let i = 0; i < moved.length; i += 1) {
      if (pairs[i]) {
        continue;
      }
      if (i < originals.length && !used.has(i)) {
        used.add(i);
        pairs[i] = { originalMsg: originals[i], movedMsg: moved[i] };
        continue;
      }
      while (nextUnused < originals.length && used.has(nextUnused)) {
        nextUnused += 1;
      }
      if (nextUnused < originals.length) {
        used.add(nextUnused);
        pairs[i] = { originalMsg: originals[nextUnused], movedMsg: moved[i] };
      } else {
        pairs[i] = { originalMsg: null, movedMsg: moved[i] };
      }
    }

    return pairs;
  }

  /**
   * Fetch current account display names and Trash folder IDs safely.
   * @returns {Promise<{ accountNames: Record<string, string>, trashFolderIds: Set<string> }>}
   */
  async function getAccountAndTrashContext() {
    const accountNames = {};
    const trashFolderIds = new Set();

    try {
      const accounts = await api.accounts.list(false);
      for (const acc of accounts || []) {
        if (acc && acc.id) {
          accountNames[acc.id] = acc.name || acc.id;
        }
      }
    } catch (err) {
      console.error("[MailAudit] Hesap listesi alınamadı:", err);
    }

    try {
      const trashFolders = await api.folders.query({ specialUse: ["trash"] });
      for (const folder of trashFolders || []) {
        if (folder && folder.id) {
          trashFolderIds.add(folder.id);
        }
      }
    } catch (err) {
      console.error("[MailAudit] Çöp Kutusu klasörleri sorgulanamadı:", err);
    }

    return { accountNames, trashFolderIds };
  }

  /**
   * Update the toolbar action badge with the current count of trashed records.
   */
  async function updateToolbarBadge() {
    if (!api.action || typeof api.action.setBadgeText !== "function") {
      return;
    }
    try {
      const [records, settings] = await Promise.all([
        storageManager.getRecordsList(),
        storageManager.getSettings()
      ]);

      if (!settings.showBadgeCount) {
        await api.action.setBadgeText({ text: "" });
        return;
      }

      let trashedCount = 0;
      for (const rec of records) {
        if (rec && rec.status === "trashed") {
          trashedCount += 1;
        }
      }

      const text = trashedCount <= 0
        ? ""
        : (trashedCount > 99 ? "99+" : String(trashedCount));

      await api.action.setBadgeText({ text });
      if (text && typeof api.action.setBadgeBackgroundColor === "function") {
        await api.action.setBadgeBackgroundColor({ color: "#D97706" });
      }
    } catch (err) {
      console.error("[MailAudit] Araç çubuğu rozeti güncellenemedi:", err);
    }
  }

  async function handleNewMailReceived(folder, messageList) {
    try {
      const settings = await storageManager.getSettings();
      if (!settings.trackIncoming) {
        return;
      }

      const [messages, ctx] = await Promise.all([
        collectMessageList(messageList),
        getAccountAndTrashContext()
      ]);
      if (messages.length === 0) {
        return;
      }
      await storageManager.updateRecords((map) =>
        Store.applyIncomingMessages(map, messages, folder, {
          ...ctx,
          now: Date.now()
        })
      );
      await updateToolbarBadge();
    } catch (err) {
      console.error("[MailAudit] Yeni mail kaydedilirken hata:", err);
    }
  }

  async function handleMessagesMoved(originalMessageList, movedMessageList) {
    try {
      const settings = await storageManager.getSettings();
      if (!settings.trackTrash) {
        return;
      }

      const [originals, moved, ctx] = await Promise.all([
        collectMessageList(originalMessageList),
        collectMessageList(movedMessageList),
        getAccountAndTrashContext()
      ]);
      const pairs = pairMovedMessages(originals, moved);
      if (pairs.length === 0) {
        return;
      }
      await storageManager.updateRecords((map) =>
        Store.applyMovedMessages(map, pairs, {
          ...ctx,
          now: Date.now()
        })
      );
      await updateToolbarBadge();
    } catch (err) {
      console.error("[MailAudit] Taşıma/silme olayı işlenirken hata:", err);
    }
  }

  async function handleMessagesDeleted(messageList) {
    try {
      const settings = await storageManager.getSettings();
      if (!settings.trackPermanentDelete) {
        return;
      }

      const [messages, ctx] = await Promise.all([
        collectMessageList(messageList),
        getAccountAndTrashContext()
      ]);
      if (messages.length === 0) {
        return;
      }
      await storageManager.updateRecords((map) =>
        Store.applyDeletedMessages(map, messages, {
          ...ctx,
          now: Date.now()
        })
      );
      await updateToolbarBadge();
    } catch (err) {
      console.error("[MailAudit] Kalıcı silme olayı işlenirken hata:", err);
    }
  }

  async function ensureSpace() {
    if (!api.spaces || typeof api.spaces.query !== "function" || typeof api.spaces.create !== "function") {
      return null;
    }

    const url = api.runtime.getURL(DASHBOARD_PATH);
    const existing = await api.spaces.query({ isSelfOwned: true });
    const found = (existing || []).find((space) => space && space.name === SPACE_NAME);
    if (found) {
      return found;
    }

    try {
      return await api.spaces.create(
        SPACE_NAME,
        { url },
        { title: "Mail Tarihçe", defaultIcons: "icons/icon.svg" }
      );
    } catch (_err) {
      return await api.spaces.create(
        SPACE_NAME,
        { url },
        { title: "Mail Tarihçe" }
      );
    }
  }

  async function openDashboard(view) {
    const baseUrl = api.runtime.getURL(DASHBOARD_PATH);
    const targetUrl = view ? `${baseUrl}#${encodeURIComponent(view)}` : baseUrl;

    if (view && api.storage?.local?.set) {
      try {
        await api.storage.local.set({ [PENDING_VIEW_KEY]: view });
      } catch (_err) {
        // Non-critical hint for initial tab load.
      }
    }

    try {
      const space = await ensureSpace();
      if (space && api.spaces && typeof api.spaces.open === "function") {
        await api.spaces.open(space.id);
        if (view && typeof api.runtime.sendMessage === "function") {
          api.runtime.sendMessage({ type: "switchView", view }).catch(() => {});
        }
        return;
      }
    } catch (err) {
      console.error("[MailAudit] Alan açılırken hata, sekmeye geçiliyor:", err);
    }

    const tabs = await api.tabs.query({ url: `${baseUrl}*` });
    if (tabs && tabs.length > 0) {
      await api.tabs.update(tabs[0].id, { active: true });
      if (view && typeof api.runtime.sendMessage === "function") {
        api.runtime.sendMessage({ type: "switchView", view }).catch(() => {});
      }
      return;
    }

    await api.tabs.create({ url: targetUrl });
  }

  function handleRuntimeMessage(message) {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    if (message.type === "openDashboard") {
      return openDashboard(message.view).then(() => ({ ok: true }));
    }
    if (message.type === "refreshBadge") {
      return updateToolbarBadge().then(() => ({ ok: true }));
    }
    return undefined;
  }

  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }
    if (changes[Store.STORAGE_KEY] || changes[Store.SETTINGS_KEY]) {
      updateToolbarBadge().catch((err) => console.error("[MailAudit] Rozet hatası:", err));
    }
  }

  // Register all MV3 event listeners synchronously at top level.
  api.messages.onNewMailReceived.addListener(handleNewMailReceived, true);
  api.messages.onMoved.addListener(handleMessagesMoved);
  api.messages.onDeleted.addListener(handleMessagesDeleted);

  if (api.action?.onClicked?.addListener) {
    api.action.onClicked.addListener(() => {
      openDashboard().catch((err) => console.error("[MailAudit] Panel açma hatası:", err));
    });
  }

  if (api.runtime?.onMessage?.addListener) {
    api.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  if (api.storage?.onChanged?.addListener) {
    api.storage.onChanged.addListener(handleStorageChanged);
  }

  api.runtime.onInstalled.addListener(() => {
    ensureSpace().catch((err) => console.error("[MailAudit] Alan kurulumu hatası:", err));
    updateToolbarBadge().catch((err) => console.error("[MailAudit] İlk rozet hatası:", err));
  });

  api.runtime.onStartup.addListener(() => {
    ensureSpace().catch((err) => console.error("[MailAudit] Başlangıç alanı hatası:", err));
    updateToolbarBadge().catch((err) => console.error("[MailAudit] Başlangıç rozet hatası:", err));
  });

  ensureSpace().catch((err) => console.error("[MailAudit] Alan oluşturma hatası:", err));
  updateToolbarBadge().catch((err) => console.error("[MailAudit] Rozet güncelleme hatası:", err));

  const exported = {
    SPACE_NAME,
    DASHBOARD_PATH,
    PENDING_VIEW_KEY,
    collectMessageList,
    pairMovedMessages,
    getAccountAndTrashContext,
    updateToolbarBadge,
    handleNewMailReceived,
    handleMessagesMoved,
    handleMessagesDeleted,
    handleRuntimeMessage,
    ensureSpace,
    openDashboard
  };

  root.MailAuditBackground = exported;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
