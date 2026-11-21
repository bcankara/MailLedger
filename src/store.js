(function initMailAuditStore(root) {
  "use strict";

  const STORAGE_KEY = "mailAuditRecords";
  const SETTINGS_KEY = "mailAuditSettings";
  const DEFAULT_MAX_RECORDS = 25000;
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const DEFAULT_SETTINGS = {
    maxRecords: DEFAULT_MAX_RECORDS,
    trackIncoming: true,
    trackTrash: true,
    trackPermanentDelete: true,
    showBadgeCount: true,
    theme: "system" // "system" | "light" | "dark"
  };

  /**
   * Convert a Date, ISO string, or epoch number into a finite millisecond epoch.
   * @param {Date|string|number|null|undefined} dateValue
   * @returns {number|null}
   */
  function normalizeTimestamp(dateValue) {
    if (dateValue === null || dateValue === undefined || dateValue === "") {
      return null;
    }
    if (dateValue instanceof Date) {
      const ms = dateValue.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof dateValue === "number") {
      return Number.isFinite(dateValue) ? dateValue : null;
    }
    if (typeof dateValue === "string") {
      const ms = Date.parse(dateValue);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  }

  /**
   * Parse a YYYY-MM-DD local date string to start or end of day timestamp.
   * @param {string|number|null|undefined} value
   * @param {boolean} endOfDay
   * @returns {number|null}
   */
  function parseDateBoundary(value, endOfDay = false) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]) - 1;
        const day = Number(m[3]);
        const dt = endOfDay
          ? new Date(year, month, day, 23, 59, 59, 999)
          : new Date(year, month, day, 0, 0, 0, 0);
        return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
      }
      return normalizeTimestamp(value);
    }
    return null;
  }

  /**
   * Resolve a stable composite record key for a Thunderbird MessageHeader.
   * @param {object} msg
   * @returns {string}
   */
  function makeRecordKey(msg) {
    const accountId = msg?.folder?.accountId || msg?.accountId || "unknown";
    const rawHeaderId = typeof msg?.headerMessageId === "string"
      ? msg.headerMessageId.trim()
      : "";

    if (rawHeaderId) {
      return `${accountId}::${rawHeaderId}`;
    }

    const receivedMs = normalizeTimestamp(msg?.date) ?? 0;
    const author = (msg?.author || "").trim();
    const subject = (msg?.subject || "").trim();
    return `${accountId}::fallback::${receivedMs}::${author}::${subject}`;
  }

  /**
   * Format a MailFolder object into a clean human-readable folder path.
   * @param {object|null|undefined} folder
   * @returns {string|null}
   */
  function formatFolderLabel(folder) {
    if (!folder) {
      return null;
    }
    const raw = folder.path || folder.name || "";
    const cleaned = String(raw).replace(/^\/+/, "").trim();
    return cleaned || null;
  }

  /**
   * Determine whether a MailFolder represents a Trash folder.
   * @param {object|null|undefined} folder
   * @param {Set<string>|null|undefined} trashFolderIds
   * @returns {boolean}
   */
  function isTrashFolder(folder, trashFolderIds) {
    if (!folder) {
      return false;
    }
    if (Array.isArray(folder.specialUse) && folder.specialUse.includes("trash")) {
      return true;
    }
    if (folder.type === "trash") {
      return true;
    }
    if (trashFolderIds && folder.id && trashFolderIds.has(folder.id)) {
      return true;
    }
    return false;
  }

  function resolveMessageFolder(msg, fallbackFolder) {
    return msg?.folder || fallbackFolder || null;
  }

  function withFolderFallback(msg, fallbackFolder) {
    if (msg?.folder || !fallbackFolder) {
      return msg;
    }
    return { ...msg, folder: fallbackFolder };
  }

  /**
   * Construct a fresh audit log record from a Thunderbird MessageHeader.
   * @param {object} msg
   * @param {{ accountName?: string, folderLabel?: string|null, now?: number }} opts
   * @returns {object}
   */
  function buildBaseRecord(msg, { accountName, folderLabel, now } = {}) {
    const timestamp = Number.isFinite(now) ? now : Date.now();
    const accountId = msg?.folder?.accountId || msg?.accountId || "unknown";
    const key = makeRecordKey(msg);
    const subject = msg?.subject && msg.subject.trim()
      ? msg.subject.trim()
      : "(Konu yok)";

    return {
      key,
      headerMessageId: typeof msg?.headerMessageId === "string" ? msg.headerMessageId.trim() : "",
      subject,
      author: msg?.author || "",
      accountId,
      accountName: accountName || accountId,
      receivedAt: normalizeTimestamp(msg?.date),
      recordedAt: timestamp,
      status: "active",
      deletedAt: null,
      permanentlyDeletedAt: null,
      restoredAt: null,
      preExistingTrash: false,
      originalFolderId: msg?.folder?.id || null,
      originalFolderPath: folderLabel ?? formatFolderLabel(msg?.folder),
      currentFolderId: msg?.folder?.id || null,
      currentFolderPath: folderLabel ?? formatFolderLabel(msg?.folder),
      lastMessageId: typeof msg?.id === "number" ? msg.id : null
    };
  }

  /**
   * Record newly received (or scanned inbox) messages into the audit map.
   * Preserves existing trashed/deleted statuses so scans never erase deletion history.
   * @param {Record<string, object>} recordsMap
   * @param {Array<object>} messages
   * @param {object|null} folder
   * @param {{ now?: number, accountNames?: Record<string, string>, trashFolderIds?: Set<string> }} ctx
   * @returns {Record<string, object>}
   */
  function applyIncomingMessages(recordsMap, messages, folder, ctx = {}) {
    const nextMap = { ...(recordsMap || {}) };
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const accountNames = ctx.accountNames || {};
    const trashFolderIds = ctx.trashFolderIds;

    for (const rawMsg of messages || []) {
      if (!rawMsg) {
        continue;
      }
      const msg = withFolderFallback(rawMsg, folder);
      const msgFolder = resolveMessageFolder(msg, folder);
      const accountId = msgFolder?.accountId || msg.accountId || "unknown";
      const accountName = accountNames[accountId] || accountId;
      const folderLabel = formatFolderLabel(msgFolder);
      const inTrash = isTrashFolder(msgFolder, trashFolderIds);
      const key = makeRecordKey(msg);
      const existing = nextMap[key];

      if (!existing) {
        const record = buildBaseRecord(msg, { accountName, folderLabel, now });
        if (inTrash) {
          record.status = "trashed";
          record.deletedAt = now;
          record.originalFolderId = null;
          record.originalFolderPath = null;
        }
        nextMap[key] = record;
        continue;
      }

      const updated = {
        ...existing,
        accountName: accountName || existing.accountName,
        lastMessageId: typeof msg.id === "number" ? msg.id : existing.lastMessageId
      };

      if (inTrash && existing.status === "active") {
        updated.status = "trashed";
        updated.deletedAt = existing.deletedAt ?? now;
        updated.preExistingTrash = false;
        updated.currentFolderId = msgFolder?.id || existing.currentFolderId;
        updated.currentFolderPath = folderLabel || existing.currentFolderPath;
      }

      nextMap[key] = updated;
    }

    return nextMap;
  }

  /**
   * Record pre-existing Trash messages discovered during a manual Trash folder scan.
   * Never fabricates a deletion date for emails that were deleted before add-on installation.
   * @param {Record<string, object>} recordsMap
   * @param {Array<object>} messages
   * @param {object|null} folder
   * @param {{ now?: number, accountNames?: Record<string, string> }} ctx
   * @returns {Record<string, object>}
   */
  function applyScannedTrashMessages(recordsMap, messages, folder, ctx = {}) {
    const nextMap = { ...(recordsMap || {}) };
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const accountNames = ctx.accountNames || {};

    for (const rawMsg of messages || []) {
      if (!rawMsg) {
        continue;
      }
      const msg = withFolderFallback(rawMsg, folder);
      const msgFolder = resolveMessageFolder(msg, folder);
      const accountId = msgFolder?.accountId || msg.accountId || "unknown";
      const accountName = accountNames[accountId] || accountId;
      const folderLabel = formatFolderLabel(msgFolder);
      const key = makeRecordKey(msg);
      const existing = nextMap[key];

      if (!existing) {
        const record = buildBaseRecord(msg, { accountName, folderLabel, now });
        record.status = "trashed";
        record.deletedAt = null;
        record.preExistingTrash = true;
        record.originalFolderId = null;
        record.originalFolderPath = null;
        record.currentFolderId = msgFolder?.id || null;
        record.currentFolderPath = folderLabel;
        nextMap[key] = record;
        continue;
      }

      const updated = {
        ...existing,
        accountName: accountName || existing.accountName,
        lastMessageId: typeof msg.id === "number" ? msg.id : existing.lastMessageId
      };

      if (existing.status === "active") {
        updated.status = "trashed";
        updated.preExistingTrash = existing.deletedAt == null;
        updated.currentFolderId = msgFolder?.id || existing.currentFolderId;
        updated.currentFolderPath = folderLabel || existing.currentFolderPath;
      } else if (existing.status === "trashed") {
        updated.currentFolderId = msgFolder?.id || existing.currentFolderId;
        updated.currentFolderPath = folderLabel || existing.currentFolderPath;
      }

      nextMap[key] = updated;
    }

    return nextMap;
  }

  /**
   * Update audit records when messages are moved between folders.
   * Captures deletion timestamps when moved into Trash (even for untracked old emails).
   * @param {Record<string, object>} recordsMap
   * @param {Array<{ originalMsg?: object, movedMsg?: object }>} pairs
   * @param {{ now?: number, accountNames?: Record<string, string>, trashFolderIds?: Set<string> }} ctx
   * @returns {Record<string, object>}
   */
  function applyMovedMessages(recordsMap, pairs, ctx = {}) {
    const nextMap = { ...(recordsMap || {}) };
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const accountNames = ctx.accountNames || {};
    const trashFolderIds = ctx.trashFolderIds;

    for (const pair of pairs || []) {
      const originalMsg = pair?.originalMsg || null;
      const movedMsg = pair?.movedMsg || null;
      const primaryMsg = movedMsg || originalMsg;
      if (!primaryMsg) {
        continue;
      }

      const key = makeRecordKey(primaryMsg);
      const origKey = originalMsg ? makeRecordKey(originalMsg) : null;
      const existing = nextMap[key] || (origKey ? nextMap[origKey] : null);

      const fromTrash = isTrashFolder(originalMsg?.folder, trashFolderIds);
      const toTrash = isTrashFolder(movedMsg?.folder, trashFolderIds);
      const accountId = primaryMsg.folder?.accountId || existing?.accountId || primaryMsg.accountId || "unknown";
      const accountName = accountNames[accountId] || existing?.accountName || accountId;

      if (toTrash && !fromTrash) {
        const base = existing
          ? { ...existing }
          : buildBaseRecord(primaryMsg, {
              accountName,
              folderLabel: formatFolderLabel(originalMsg?.folder) || formatFolderLabel(movedMsg?.folder),
              now
            });

        base.key = key;
        base.accountId = accountId;
        base.accountName = accountName;
        base.status = "trashed";
        base.deletedAt = now;
        base.permanentlyDeletedAt = null;
        base.restoredAt = null;
        base.preExistingTrash = false;
        base.originalFolderId = originalMsg?.folder?.id || existing?.originalFolderId || null;
        base.originalFolderPath = formatFolderLabel(originalMsg?.folder) || existing?.originalFolderPath || null;
        base.currentFolderId = movedMsg?.folder?.id || null;
        base.currentFolderPath = formatFolderLabel(movedMsg?.folder);
        base.lastMessageId = typeof movedMsg?.id === "number" ? movedMsg.id : (existing?.lastMessageId ?? null);

        if (origKey && origKey !== key) {
          delete nextMap[origKey];
        }
        nextMap[key] = base;
        continue;
      }

      if (fromTrash && !toTrash) {
        const base = existing
          ? { ...existing }
          : buildBaseRecord(primaryMsg, {
              accountName,
              folderLabel: formatFolderLabel(movedMsg?.folder),
              now
            });

        base.key = key;
        base.accountId = accountId;
        base.accountName = accountName;
        base.status = "active";
        base.deletedAt = null;
        base.permanentlyDeletedAt = null;
        base.restoredAt = now;
        base.preExistingTrash = false;
        base.currentFolderId = movedMsg?.folder?.id || null;
        base.currentFolderPath = formatFolderLabel(movedMsg?.folder);
        base.originalFolderId = movedMsg?.folder?.id || null;
        base.originalFolderPath = formatFolderLabel(movedMsg?.folder);
        base.lastMessageId = typeof movedMsg?.id === "number" ? movedMsg.id : null;

        if (origKey && origKey !== key) {
          delete nextMap[origKey];
        }
        nextMap[key] = base;
        continue;
      }

      if (existing) {
        const updated = {
          ...existing,
          key,
          accountId,
          accountName,
          currentFolderId: movedMsg?.folder?.id ?? existing.currentFolderId,
          currentFolderPath: formatFolderLabel(movedMsg?.folder) ?? existing.currentFolderPath,
          lastMessageId: typeof movedMsg?.id === "number" ? movedMsg.id : existing.lastMessageId
        };
        if (!fromTrash && !toTrash) {
          updated.originalFolderId = movedMsg?.folder?.id ?? existing.originalFolderId;
          updated.originalFolderPath = formatFolderLabel(movedMsg?.folder) ?? existing.originalFolderPath;
        }
        if (origKey && origKey !== key) {
          delete nextMap[origKey];
        }
        nextMap[key] = updated;
      }
    }

    return nextMap;
  }

  /**
   * Mark permanently deleted messages (Trash purge or Shift+Delete).
   * Preserves prior Trash deletion timestamp when available.
   * @param {Record<string, object>} recordsMap
   * @param {Array<object>} messages
   * @param {{ now?: number, accountNames?: Record<string, string> }} ctx
   * @returns {Record<string, object>}
   */
  function applyDeletedMessages(recordsMap, messages, ctx = {}) {
    const nextMap = { ...(recordsMap || {}) };
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const accountNames = ctx.accountNames || {};

    for (const msg of messages || []) {
      if (!msg) {
        continue;
      }
      const key = makeRecordKey(msg);
      const existing = nextMap[key];
      const accountId = msg.folder?.accountId || existing?.accountId || msg.accountId || "unknown";
      const accountName = accountNames[accountId] || existing?.accountName || accountId;
      const base = existing
        ? { ...existing }
        : buildBaseRecord(msg, {
            accountName,
            folderLabel: formatFolderLabel(msg.folder),
            now
          });

      base.accountName = accountName;
      base.status = "deleted";
      base.permanentlyDeletedAt = now;
      base.deletedAt = base.deletedAt ?? now;
      base.preExistingTrash = false;
      base.currentFolderId = null;
      base.currentFolderPath = null;
      base.lastMessageId = null;

      nextMap[key] = base;
    }

    return nextMap;
  }

  /**
   * Prune excess records while keeping deletion logs longer than old active records.
   * @param {Record<string, object>} recordsMap
   * @param {number} maxRecords
   * @returns {Record<string, object>}
   */
  function pruneRecords(recordsMap, maxRecords = DEFAULT_MAX_RECORDS) {
    const map = recordsMap || {};
    const keys = Object.keys(map);
    if (keys.length <= maxRecords) {
      return map;
    }

    const limit = Math.max(0, maxRecords);
    const entries = keys.map((key) => [key, map[key]]);
    entries.sort(([, a], [, b]) => {
      const aGroup = a.status === "active" ? 0 : 1;
      const bGroup = b.status === "active" ? 0 : 1;
      if (aGroup !== bGroup) {
        return aGroup - bGroup;
      }
      const aTs = aGroup === 0
        ? (a.receivedAt ?? a.recordedAt ?? 0)
        : (a.deletedAt ?? a.permanentlyDeletedAt ?? a.recordedAt ?? 0);
      const bTs = bGroup === 0
        ? (b.receivedAt ?? b.recordedAt ?? 0)
        : (b.deletedAt ?? b.permanentlyDeletedAt ?? b.recordedAt ?? 0);
      return aTs - bTs;
    });

    const keepEntries = entries.slice(entries.length - limit);
    const pruned = {};
    for (const [key, rec] of keepEntries) {
      pruned[key] = rec;
    }
    return pruned;
  }

  /**
   * Filter and sort audit records for the dashboard and popup views.
   * Sorting by `deletedAt` always places records without a deletion date last.
   * @param {Array<object>} records
   * @param {{ search?: string, status?: string, accountId?: string, dateField?: string, dateFrom?: string|number, dateTo?: string|number, sortBy?: string, sortDir?: string }} options
   * @returns {Array<object>}
   */
  function filterAndSortRecords(records, options = {}) {
    const {
      search = "",
      status = "all",
      accountId = "all",
      dateField = "deletedAt",
      dateFrom = "",
      dateTo = "",
      sortBy = "deletedAt",
      sortDir = "desc"
    } = options;

    const query = String(search || "").trim().toLocaleLowerCase("tr-TR");
    const fromMs = parseDateBoundary(dateFrom, false);
    const toMs = parseDateBoundary(dateTo, true);
    const activeDateField = dateField === "receivedAt" ? "receivedAt" : "deletedAt";

    const filtered = (records || []).filter((rec) => {
      if (!rec) {
        return false;
      }
      if (status === "deleted_any") {
        if (rec.status !== "trashed" && rec.status !== "deleted") {
          return false;
        }
      } else if (status !== "all" && rec.status !== status) {
        return false;
      }

      if (accountId && accountId !== "all" && rec.accountId !== accountId) {
        return false;
      }

      if (fromMs !== null || toMs !== null) {
        const targetTs = rec[activeDateField];
        if (targetTs === null || targetTs === undefined) {
          return false;
        }
        if (fromMs !== null && targetTs < fromMs) {
          return false;
        }
        if (toMs !== null && targetTs > toMs) {
          return false;
        }
      }

      if (query) {
        const haystack = [
          rec.subject,
          rec.author,
          rec.accountName,
          rec.originalFolderPath,
          rec.currentFolderPath,
          rec.headerMessageId
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    });

    const dirFactor = sortDir === "asc" ? 1 : -1;
    const statusOrder = { trashed: 0, deleted: 1, active: 2 };

    filtered.sort((a, b) => {
      if (sortBy === "deletedAt") {
        const aVal = a.deletedAt;
        const bVal = b.deletedAt;
        if (aVal == null && bVal == null) {
          return (b.receivedAt ?? b.recordedAt ?? 0) - (a.receivedAt ?? a.recordedAt ?? 0);
        }
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (aVal !== bVal) {
          return dirFactor * (aVal - bVal);
        }
        return (b.receivedAt ?? 0) - (a.receivedAt ?? 0);
      }

      if (sortBy === "receivedAt") {
        const aVal = a.receivedAt;
        const bVal = b.receivedAt;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return dirFactor * (aVal - bVal);
      }

      if (sortBy === "activity") {
        const aVal = Math.max(
          a.permanentlyDeletedAt || 0,
          a.deletedAt || 0,
          a.restoredAt || 0,
          a.receivedAt || 0,
          a.recordedAt || 0
        );
        const bVal = Math.max(
          b.permanentlyDeletedAt || 0,
          b.deletedAt || 0,
          b.restoredAt || 0,
          b.receivedAt || 0,
          b.recordedAt || 0
        );
        return dirFactor * (aVal - bVal);
      }

      if (sortBy === "subject") {
        return dirFactor * String(a.subject || "").localeCompare(
          String(b.subject || ""),
          "tr-TR",
          { sensitivity: "base" }
        );
      }

      if (sortBy === "author") {
        return dirFactor * String(a.author || "").localeCompare(
          String(b.author || ""),
          "tr-TR",
          { sensitivity: "base" }
        );
      }

      if (sortBy === "status") {
        const aRank = statusOrder[a.status] ?? 99;
        const bRank = statusOrder[b.status] ?? 99;
        return dirFactor * (aRank - bRank);
      }

      return 0;
    });

    return filtered;
  }

  function toLocalDateKey(timestamp) {
    const dt = new Date(timestamp);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /**
   * Compute summary metrics, per-account breakdown, top folders, and 14-day deletion timeline.
   * @param {Array<object>} records
   * @param {number} now
   */
  function computeStatistics(records, now = Date.now()) {
    const list = records || [];
    const todayKey = toLocalDateKey(now);

    let trashed = 0;
    let deleted = 0;
    let active = 0;
    let deletedToday = 0;

    const accountMap = new Map();
    const folderCounts = new Map();
    const dailyMap = new Map();

    // Build last 14 local days timeline skeleton
    const dailyKeys = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const dt = new Date(now);
      dt.setHours(12, 0, 0, 0);
      dt.setDate(dt.getDate() - offset);
      const dateKey = toLocalDateKey(dt.getTime());
      const label = `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
      dailyKeys.push({ dateKey, label });
      dailyMap.set(dateKey, 0);
    }

    for (const rec of list) {
      if (!rec) continue;
      if (rec.status === "trashed") trashed += 1;
      else if (rec.status === "deleted") deleted += 1;
      else if (rec.status === "active") active += 1;

      const accId = rec.accountId || "unknown";
      if (!accountMap.has(accId)) {
        accountMap.set(accId, {
          accountId: accId,
          accountName: rec.accountName || accId,
          total: 0,
          active: 0,
          trashed: 0,
          deleted: 0
        });
      }
      const acc = accountMap.get(accId);
      acc.total += 1;
      if (rec.status === "active") acc.active += 1;
      else if (rec.status === "trashed") acc.trashed += 1;
      else if (rec.status === "deleted") acc.deleted += 1;

      if (rec.status === "trashed" || rec.status === "deleted") {
        const folderLabel = rec.originalFolderPath || rec.currentFolderPath || "(Bilinmeyen Klasör)";
        folderCounts.set(folderLabel, (folderCounts.get(folderLabel) || 0) + 1);
      }

      if (rec.deletedAt != null && Number.isFinite(Number(rec.deletedAt))) {
        const dKey = toLocalDateKey(Number(rec.deletedAt));
        if (dKey === todayKey) {
          deletedToday += 1;
        }
        if (dailyMap.has(dKey)) {
          dailyMap.set(dKey, dailyMap.get(dKey) + 1);
        }
      }
    }

    const byAccount = Array.from(accountMap.values()).sort((a, b) => b.total - a.total);
    const topDeletedFolders = Array.from(folderCounts.entries())
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const dailyDeletions = dailyKeys.map((item) => ({
      dateKey: item.dateKey,
      label: item.label,
      count: dailyMap.get(item.dateKey) || 0
    }));

    return {
      total: list.length,
      trashed,
      deleted,
      active,
      deletedAny: trashed + deleted,
      deletedToday,
      byAccount,
      topDeletedFolders,
      dailyDeletions
    };
  }

  /**
   * Sanitize and merge a JSON backup string (or parsed object/array) into existing records.
   * Guards against prototype pollution and preserves richer existing deletion timestamps.
   * @param {string|object|Array<object>} input
   * @param {Record<string, object>} existingMap
   * @returns {{ recordsMap: Record<string, object>, importedCount: number, updatedCount: number, skippedCount: number }}
   */
  function importRecordsFromJson(input, existingMap = {}) {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    let items = [];

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed && Array.isArray(parsed.records)) {
      items = parsed.records;
    } else if (parsed && parsed.recordsMap && typeof parsed.recordsMap === "object") {
      items = Object.values(parsed.recordsMap);
    } else {
      throw new Error("Geçersiz JSON yedek biçimi.");
    }

    const nextMap = { ...(existingMap || {}) };
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    const validStatuses = new Set(["active", "trashed", "deleted"]);

    for (const raw of items) {
      if (!raw || typeof raw !== "object") {
        skippedCount += 1;
        continue;
      }

      const rawKey = typeof raw.key === "string" && raw.key.trim()
        ? raw.key.trim()
        : makeRecordKey({
            accountId: raw.accountId,
            headerMessageId: raw.headerMessageId,
            date: raw.receivedAt,
            author: raw.author,
            subject: raw.subject
          });

      if (!rawKey || FORBIDDEN_KEYS.has(rawKey)) {
        skippedCount += 1;
        continue;
      }

      const status = validStatuses.has(raw.status) ? raw.status : "active";
      const clean = {
        key: rawKey,
        headerMessageId: typeof raw.headerMessageId === "string" ? raw.headerMessageId.trim() : "",
        subject: typeof raw.subject === "string" && raw.subject.trim() ? raw.subject.trim() : "(Konu yok)",
        author: typeof raw.author === "string" ? raw.author : "",
        accountId: typeof raw.accountId === "string" && raw.accountId ? raw.accountId : "unknown",
        accountName: typeof raw.accountName === "string" && raw.accountName ? raw.accountName : (raw.accountId || "unknown"),
        receivedAt: normalizeTimestamp(raw.receivedAt),
        recordedAt: normalizeTimestamp(raw.recordedAt) ?? Date.now(),
        status,
        deletedAt: normalizeTimestamp(raw.deletedAt),
        permanentlyDeletedAt: normalizeTimestamp(raw.permanentlyDeletedAt),
        restoredAt: normalizeTimestamp(raw.restoredAt),
        preExistingTrash: Boolean(raw.preExistingTrash),
        originalFolderId: typeof raw.originalFolderId === "string" ? raw.originalFolderId : null,
        originalFolderPath: typeof raw.originalFolderPath === "string" ? raw.originalFolderPath : null,
        currentFolderId: typeof raw.currentFolderId === "string" ? raw.currentFolderId : null,
        currentFolderPath: typeof raw.currentFolderPath === "string" ? raw.currentFolderPath : null,
        lastMessageId: typeof raw.lastMessageId === "number" ? raw.lastMessageId : null
      };

      const existing = Object.prototype.hasOwnProperty.call(nextMap, rawKey) ? nextMap[rawKey] : null;
      if (!existing) {
        nextMap[rawKey] = clean;
        importedCount += 1;
        continue;
      }

      // Merge conservatively: keep richer timestamps and higher deletion state if existing is only active.
      const merged = {
        ...existing,
        deletedAt: existing.deletedAt ?? clean.deletedAt,
        permanentlyDeletedAt: existing.permanentlyDeletedAt ?? clean.permanentlyDeletedAt,
        restoredAt: existing.restoredAt ?? clean.restoredAt,
        originalFolderId: existing.originalFolderId || clean.originalFolderId,
        originalFolderPath: existing.originalFolderPath || clean.originalFolderPath
      };
      if (existing.status === "active" && clean.status !== "active") {
        merged.status = clean.status;
        merged.preExistingTrash = clean.preExistingTrash;
      }
      nextMap[rawKey] = merged;
      updatedCount += 1;
    }

    return { recordsMap: nextMap, importedCount, updatedCount, skippedCount };
  }

  /**
   * Format a timestamp in Turkish locale (DD.MM.YYYY HH:mm:ss).
   * @param {number|null|undefined} timestamp
   * @returns {string}
   */
  function formatDateTR(timestamp) {
    if (timestamp === null || timestamp === undefined || !Number.isFinite(Number(timestamp))) {
      return "—";
    }
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(Number(timestamp)));
  }

  function formatDateShortTR(timestamp) {
    if (timestamp === null || timestamp === undefined || !Number.isFinite(Number(timestamp))) {
      return "—";
    }
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date(Number(timestamp)));
  }

  function formatStatusTR(status) {
    if (status === "trashed") return "Çöp Kutusunda";
    if (status === "deleted") return "Kalıcı Silindi";
    if (status === "active") return "Aktif (Gelen)";
    return String(status || "");
  }

  function escapeCsvCell(value) {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Export records to RFC 4180 CSV with UTF-8 BOM for Turkish Excel compatibility.
   * @param {Array<object>} records
   * @returns {string}
   */
  function exportRecordsToCsv(records) {
    const headers = [
      "Durum",
      "Konu",
      "Gönderen",
      "Hesap",
      "Geliş Tarihi",
      "Silinme Tarihi",
      "Kalıcı Silinme Tarihi",
      "Orijinal Klasör",
      "Mevcut Klasör",
      "Message-ID"
    ];

    const lines = [headers.map(escapeCsvCell).join(",")];
    for (const rec of records || []) {
      const deletedDisplay = rec.deletedAt != null
        ? formatDateTR(rec.deletedAt)
        : (rec.preExistingTrash ? "Kurulum öncesi" : "—");
      const row = [
        formatStatusTR(rec.status),
        rec.subject || "",
        rec.author || "",
        rec.accountName || rec.accountId || "",
        formatDateTR(rec.receivedAt),
        deletedDisplay,
        formatDateTR(rec.permanentlyDeletedAt),
        rec.originalFolderPath || "",
        rec.currentFolderPath || "",
        rec.headerMessageId || ""
      ];
      lines.push(row.map(escapeCsvCell).join(","));
    }

    return `\uFEFF${lines.join("\r\n")}`;
  }

  /**
   * Create a serialized storage manager that prevents concurrent read-modify-write races.
   * @param {{ get: Function, set: Function }} storageArea
   */
  function createStorageManager(storageArea) {
    let queue = Promise.resolve();

    function enqueue(task) {
      const next = queue.then(task, task);
      queue = next.catch(() => {});
      return next;
    }

    async function getSettings() {
      const res = await storageArea.get(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(res?.[SETTINGS_KEY] || {}) };
    }

    async function saveSettings(partial) {
      return enqueue(async () => {
        const current = await getSettings();
        const merged = { ...current, ...(partial || {}) };
        await storageArea.set({ [SETTINGS_KEY]: merged });
        return merged;
      });
    }

    async function getRecordsMap() {
      const res = await storageArea.get(STORAGE_KEY);
      const raw = res?.[STORAGE_KEY];
      return raw && typeof raw === "object" ? { ...raw } : {};
    }

    async function getRecordsList() {
      const map = await getRecordsMap();
      return Object.values(map);
    }

    async function updateRecords(mutator) {
      return enqueue(async () => {
        const [map, settings] = await Promise.all([getRecordsMap(), getSettings()]);
        const nextMap = await mutator(map, settings);
        const maxRecords = Number.isFinite(settings.maxRecords)
          ? settings.maxRecords
          : DEFAULT_MAX_RECORDS;
        const finalMap = pruneRecords(nextMap || map, maxRecords);
        await storageArea.set({ [STORAGE_KEY]: finalMap });
        return finalMap;
      });
    }

    async function removeRecord(key) {
      return updateRecords((map) => {
        const next = { ...map };
        delete next[key];
        return next;
      });
    }

    async function removeRecordsBulk(keys) {
      const keySet = new Set(keys || []);
      if (keySet.size === 0) {
        return getRecordsMap();
      }
      return updateRecords((map) => {
        const next = { ...map };
        for (const key of keySet) {
          delete next[key];
        }
        return next;
      });
    }

    async function clearRecords(mode = "all") {
      return updateRecords((map) => {
        if (mode === "all") {
          return {};
        }
        const next = {};
        for (const [key, rec] of Object.entries(map)) {
          if (mode === "active" && rec.status !== "active") {
            next[key] = rec;
          } else if (mode === "deleted" && rec.status === "active") {
            next[key] = rec;
          }
        }
        return next;
      });
    }

    return {
      getRecordsMap,
      getRecordsList,
      updateRecords,
      removeRecord,
      removeRecordsBulk,
      clearRecords,
      getSettings,
      saveSettings
    };
  }

  const MailAuditStore = {
    STORAGE_KEY,
    SETTINGS_KEY,
    DEFAULT_MAX_RECORDS,
    DEFAULT_SETTINGS,
    normalizeTimestamp,
    parseDateBoundary,
    makeRecordKey,
    formatFolderLabel,
    isTrashFolder,
    buildBaseRecord,
    applyIncomingMessages,
    applyScannedTrashMessages,
    applyMovedMessages,
    applyDeletedMessages,
    pruneRecords,
    filterAndSortRecords,
    computeStatistics,
    importRecordsFromJson,
    formatDateTR,
    formatDateShortTR,
    formatStatusTR,
    exportRecordsToCsv,
    createStorageManager
  };

  root.MailAuditStore = MailAuditStore;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MailAuditStore;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
