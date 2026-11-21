(function initMailAuditActions(root) {
  "use strict";

  const DEFAULT_MAX_COLLECT_PER_FOLDER = 1500;
  const DEFAULT_MAX_KEEP_PER_FOLDER = 500;

  /**
   * Resolve a live Thunderbird MessageHeader corresponding to a logged audit record.
   * @param {object} api
   * @param {object} record
   * @returns {Promise<object|null>}
   */
  async function findLiveMessage(api, record) {
    if (!api?.messages || !record) {
      return null;
    }

    if (record.headerMessageId) {
      if (record.currentFolderId) {
        try {
          const scopedPage = await api.messages.query({
            headerMessageId: record.headerMessageId,
            folderId: record.currentFolderId
          });
          if (scopedPage?.messages?.length > 0) {
            return scopedPage.messages[0];
          }
        } catch (_err) {
          // Folder may no longer exist; fall back to global query.
        }
      }

      const globalPage = await api.messages.query({
        headerMessageId: record.headerMessageId
      });
      if (globalPage?.messages?.length > 0) {
        const sameAccount = globalPage.messages.find(
          (m) => m.folder?.accountId === record.accountId
        );
        return sameAccount || globalPage.messages[0];
      }

      if (record.accountId && record.accountId !== "unknown" && api.folders?.query) {
        try {
          const trashFolders = await api.folders.query({
            accountId: record.accountId,
            specialUse: ["trash"]
          });
          if (trashFolders && trashFolders.length > 0) {
            const trashPage = await api.messages.query({
              folderId: trashFolders[0].id,
              headerMessageId: record.headerMessageId
            });
            if (trashPage?.messages?.length > 0) {
              return trashPage.messages[0];
            }
          }
        } catch (_err) {
          // Ignore fallback query failures.
        }
      }
    }

    if (typeof record.lastMessageId === "number") {
      try {
        const msg = await api.messages.get(record.lastMessageId);
        if (msg) {
          return msg;
        }
      } catch (_err) {
        return null;
      }
    }

    return null;
  }

  /**
   * Determine the best target MailFolderId for restoring a trashed message.
   * Always returns a MailFolderId string (MV3 requirement).
   * @param {object} api
   * @param {object} Store
   * @param {object} record
   * @param {string|null|undefined} currentFolderId
   * @returns {Promise<string|null>}
   */
  async function resolveRestoreFolderId(api, Store, record, currentFolderId) {
    if (record.originalFolderId && record.originalFolderId !== currentFolderId) {
      try {
        const folder = await api.folders.get(record.originalFolderId);
        if (folder && folder.id && !Store.isTrashFolder(folder)) {
          return folder.id;
        }
      } catch (_err) {
        // Original folder missing; fall back to account Inbox.
      }
    }

    if (record.accountId && record.accountId !== "unknown") {
      const accountInboxes = await api.folders.query({
        accountId: record.accountId,
        specialUse: ["inbox"]
      });
      if (accountInboxes && accountInboxes.length > 0) {
        return accountInboxes[0].id;
      }
    }

    const anyInboxes = await api.folders.query({ specialUse: ["inbox"] });
    if (anyInboxes && anyInboxes.length > 0) {
      return anyInboxes[0].id;
    }

    return null;
  }

  /**
   * Open a logged message in Thunderbird's messageDisplay tab.
   * @param {object} api
   * @param {object} record
   * @returns {Promise<{ ok: boolean, errorCode?: string, error?: string }>}
   */
  async function openMessage(api, record) {
    const liveMsg = await findLiveMessage(api, record);
    if (!liveMsg) {
      return {
        ok: false,
        errorCode: "NOT_FOUND",
        error: "Message not found (it may have been purged or moved)."
      };
    }
    await api.messageDisplay.open({
      messageId: liveMsg.id,
      active: true
    });
    return { ok: true };
  }

  /**
   * Restore a trashed message back to its original folder (or account Inbox fallback).
   * @param {object} api
   * @param {object} Store
   * @param {object} record
   * @returns {Promise<{ ok: boolean, targetFolderId?: string, errorCode?: string, error?: string }>}
   */
  async function restoreMessage(api, Store, record) {
    const liveMsg = await findLiveMessage(api, record);
    if (!liveMsg) {
      return {
        ok: false,
        errorCode: "TRASH_NOT_FOUND",
        error: "Message was not found in Trash."
      };
    }

    const targetFolderId = await resolveRestoreFolderId(api, Store, record, liveMsg.folder?.id);
    if (!targetFolderId) {
      return {
        ok: false,
        errorCode: "NO_INBOX",
        error: "Target Inbox folder could not be found."
      };
    }

    await api.messages.move([liveMsg.id], targetFolderId);
    return { ok: true, targetFolderId };
  }

  /**
   * Scan all folders of a given specialUse ("inbox" or "trash") and merge headers into storage.
   * @param {object} api
   * @param {object} Store
   * @param {object} storageManager
   * @param {{ specialUse?: "inbox"|"trash", maxCollect?: number, maxKeep?: number, onProgress?: Function }} opts
   * @returns {Promise<{ folderCount: number, messageCount: number }>}
   */
  async function scanFoldersByUse(api, Store, storageManager, opts = {}) {
    const specialUse = opts.specialUse === "trash" ? "trash" : "inbox";
    const maxKeep = Number.isFinite(opts.maxKeep) && opts.maxKeep > 0
      ? opts.maxKeep
      : DEFAULT_MAX_KEEP_PER_FOLDER;
    const maxCollect = Number.isFinite(opts.maxCollect) && opts.maxCollect >= maxKeep
      ? opts.maxCollect
      : Math.max(DEFAULT_MAX_COLLECT_PER_FOLDER, maxKeep * 3);
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};

    const [accounts, targetFolders, trashFolders] = await Promise.all([
      api.accounts.list(false),
      api.folders.query({ specialUse: [specialUse] }),
      api.folders.query({ specialUse: ["trash"] })
    ]);

    const accountNames = {};
    for (const acc of accounts || []) {
      if (acc?.id) {
        accountNames[acc.id] = acc.name || acc.id;
      }
    }
    const trashFolderIds = new Set(
      (trashFolders || []).map((f) => f.id).filter(Boolean)
    );

    const folders = targetFolders || [];
    const folderBatches = [];
    let totalMessages = 0;

    for (let idx = 0; idx < folders.length; idx += 1) {
      const folder = folders[idx];
      const accLabel = accountNames[folder.accountId] || folder.accountId;
      onProgress({
        index: idx + 1,
        total: folders.length,
        accountName: accLabel,
        folderName: folder.name || folder.path || specialUse
      });

      const collected = [];
      let page = await api.messages.list(folder.id);
      if (page && Array.isArray(page.messages)) {
        collected.push(...page.messages);
      }
      while (page && page.id && collected.length < maxCollect) {
        page = await api.messages.continueList(page.id);
        if (page && Array.isArray(page.messages)) {
          collected.push(...page.messages);
        }
      }

      collected.sort((a, b) => {
        const ta = Store.normalizeTimestamp(a.date) ?? 0;
        const tb = Store.normalizeTimestamp(b.date) ?? 0;
        return tb - ta;
      });

      const newest = collected.slice(0, maxKeep);
      totalMessages += newest.length;
      folderBatches.push({ folder, messages: newest });
    }

    const now = Date.now();
    await storageManager.updateRecords((map) => {
      let next = map;
      for (const batch of folderBatches) {
        if (specialUse === "trash") {
          next = Store.applyScannedTrashMessages(next, batch.messages, batch.folder, {
            now,
            accountNames
          });
        } else {
          next = Store.applyIncomingMessages(next, batch.messages, batch.folder, {
            now,
            accountNames,
            trashFolderIds
          });
        }
      }
      return next;
    });

    return {
      folderCount: folders.length,
      messageCount: totalMessages
    };
  }

  /**
   * Apply user theme preference ("system" | "light" | "dark") to the current document root.
   * @param {string} theme
   */
  function applyTheme(theme) {
    if (typeof document === "undefined" || !document.documentElement) {
      return;
    }
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  const MailAuditActions = {
    findLiveMessage,
    resolveRestoreFolderId,
    openMessage,
    restoreMessage,
    scanFoldersByUse,
    applyTheme
  };

  root.MailAuditActions = MailAuditActions;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MailAuditActions;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
