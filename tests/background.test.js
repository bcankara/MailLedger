"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const STORE_PATH = path.resolve(__dirname, "../src/store.js");
const BG_PATH = path.resolve(__dirname, "../src/background.js");

function createMockMessenger({ hasSpacesOpen = true, existingSpaces = [] } = {}) {
  const listeners = {
    onNewMailReceived: null,
    onNewMailMonitorAll: null,
    onMoved: null,
    onDeleted: null,
    actionClicked: null,
    runtimeMessage: null,
    storageChanged: null,
    installed: null,
    startup: null
  };

  const storageBacking = {};
  const spacesList = [...existingSpaces];
  const spaceCreates = [];
  const spaceOpens = [];
  const tabCreates = [];
  const tabUpdates = [];
  const sentMessages = [];
  const badgeTexts = [];
  const badgeColors = [];

  const trashFolder = {
    id: "acc1://[Gmail]/Trash",
    accountId: "acc1",
    name: "Çöp Kutusu",
    path: "/[Gmail]/Çöp Kutusu",
    specialUse: ["trash"]
  };
  const inboxFolder = {
    id: "acc1://INBOX",
    accountId: "acc1",
    name: "Gelen Kutusu",
    path: "/INBOX",
    specialUse: ["inbox"]
  };

  const pagesById = new Map();

  const messenger = {
    _listeners: listeners,
    _storageBacking: storageBacking,
    _spaceCreates: spaceCreates,
    _spaceOpens: spaceOpens,
    _tabCreates: tabCreates,
    _tabUpdates: tabUpdates,
    _sentMessages: sentMessages,
    _badgeTexts: badgeTexts,
    _badgeColors: badgeColors,
    _pagesById: pagesById,
    _trashFolder: trashFolder,
    _inboxFolder: inboxFolder,

    accounts: {
      async list() {
        return [{ id: "acc1", name: "Ana Gmail" }];
      }
    },
    folders: {
      async query(info) {
        if (info?.specialUse?.includes("trash")) {
          return [trashFolder];
        }
        if (info?.specialUse?.includes("inbox")) {
          return [inboxFolder];
        }
        return [inboxFolder, trashFolder];
      }
    },
    messages: {
      onNewMailReceived: {
        addListener(fn, monitorAllFolders) {
          listeners.onNewMailReceived = fn;
          listeners.onNewMailMonitorAll = monitorAllFolders;
        }
      },
      onMoved: {
        addListener(fn) {
          listeners.onMoved = fn;
        }
      },
      onDeleted: {
        addListener(fn) {
          listeners.onDeleted = fn;
        }
      },
      async continueList(pageId) {
        return pagesById.get(pageId) || { id: null, messages: [] };
      }
    },
    spaces: {
      async query(queryInfo) {
        if (queryInfo?.isSelfOwned) {
          return spacesList.filter((s) => s.isSelfOwned);
        }
        return spacesList;
      },
      async create(name, tabProps, btnProps) {
        const created = {
          id: spacesList.length + 1,
          name,
          isSelfOwned: true,
          tabProps,
          btnProps
        };
        spacesList.push(created);
        spaceCreates.push(created);
        return created;
      },
      ...(hasSpacesOpen
        ? {
            async open(spaceId) {
              spaceOpens.push(spaceId);
            }
          }
        : {})
    },
    action: {
      onClicked: {
        addListener(fn) {
          listeners.actionClicked = fn;
        }
      },
      async setBadgeText({ text }) {
        badgeTexts.push(text);
      },
      async setBadgeBackgroundColor({ color }) {
        badgeColors.push(color);
      }
    },
    tabs: {
      async query() {
        return [];
      },
      async update(tabId, props) {
        tabUpdates.push({ tabId, props });
      },
      async create(props) {
        tabCreates.push(props);
        return { id: 99, ...props };
      }
    },
    runtime: {
      getURL(rel) {
        return `moz-extension://test-id/${rel}`;
      },
      async sendMessage(msg) {
        sentMessages.push(msg);
      },
      onMessage: {
        addListener(fn) {
          listeners.runtimeMessage = fn;
        }
      },
      onInstalled: {
        addListener(fn) {
          listeners.installed = fn;
        }
      },
      onStartup: {
        addListener(fn) {
          listeners.startup = fn;
        }
      }
    },
    storage: {
      onChanged: {
        addListener(fn) {
          listeners.storageChanged = fn;
        }
      },
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: storageBacking[key] };
          }
          return { ...storageBacking };
        },
        async set(obj) {
          Object.assign(storageBacking, obj);
        },
        async remove(key) {
          delete storageBacking[key];
        }
      }
    }
  };

  return messenger;
}

describe("background event handler integration", () => {
  let previousMessenger;

  beforeEach(() => {
    previousMessenger = globalThis.messenger;
    delete require.cache[STORE_PATH];
    delete require.cache[BG_PATH];
  });

  afterEach(() => {
    delete require.cache[STORE_PATH];
    delete require.cache[BG_PATH];
    if (previousMessenger === undefined) {
      delete globalThis.messenger;
    } else {
      globalThis.messenger = previousMessenger;
    }
  });

  it("registers all MV3 listeners synchronously at top level", async () => {
    const mock = createMockMessenger();
    globalThis.messenger = mock;

    require(STORE_PATH);
    require(BG_PATH);
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(typeof mock._listeners.onNewMailReceived, "function");
    assert.equal(mock._listeners.onNewMailMonitorAll, true);
    assert.equal(typeof mock._listeners.onMoved, "function");
    assert.equal(typeof mock._listeners.onDeleted, "function");
    assert.equal(typeof mock._listeners.runtimeMessage, "function");
    assert.equal(typeof mock._listeners.storageChanged, "function");
    assert.equal(typeof mock._listeners.installed, "function");
    assert.equal(typeof mock._listeners.startup, "function");
  });

  it("handles paginated incoming mails, deleting an old mail, restoring, permanent delete, and badge updates", async () => {
    const mock = createMockMessenger();
    globalThis.messenger = mock;

    const Store = require(STORE_PATH);
    require(BG_PATH);
    await new Promise((r) => setTimeout(r, 15));

    // 1. Paginated new mail arrival
    mock._pagesById.set("page-2", {
      id: null,
      messages: [
        {
          id: 2,
          headerMessageId: "<new-2@test>",
          subject: "İkinci Mail",
          author: "b@test.com",
          date: "2026-11-21T08:00:00Z",
          folder: mock._inboxFolder
        }
      ]
    });

    await mock._listeners.onNewMailReceived(mock._inboxFolder, {
      id: "page-2",
      messages: [
        {
          id: 1,
          headerMessageId: "<new-1@test>",
          subject: "Birinci Mail",
          author: "a@test.com",
          date: "2026-11-21T07:59:00Z",
          folder: mock._inboxFolder
        }
      ]
    });

    // 2. Delete an old pre-existing email into [Gmail]/Çöp Kutusu
    const oldDate = "2020-02-14T15:00:00Z";
    await mock._listeners.onMoved(
      {
        id: null,
        messages: [
          {
            id: 400,
            headerMessageId: "<old-2020@test>",
            subject: "2020 Sözleşme",
            author: "hukuk@test.com",
            date: oldDate,
            folder: mock._inboxFolder
          }
        ]
      },
      {
        id: null,
        messages: [
          {
            id: 401,
            headerMessageId: "<old-2020@test>",
            subject: "2020 Sözleşme",
            author: "hukuk@test.com",
            date: oldDate,
            folder: mock._trashFolder
          }
        ]
      }
    );

    assert.equal(mock._badgeTexts.at(-1), "1");

    // 3. Permanently delete <new-2@test>
    await mock._listeners.onDeleted({
      id: null,
      messages: [
        {
          id: 2,
          headerMessageId: "<new-2@test>",
          subject: "İkinci Mail",
          author: "b@test.com",
          date: "2026-11-21T08:00:00Z",
          folder: mock._inboxFolder
        }
      ]
    });

    const saved = mock._storageBacking[Store.STORAGE_KEY];
    assert.equal(saved["acc1::<new-2@test>"].status, "deleted");
    assert.equal(saved["acc1::<old-2020@test>"].status, "trashed");
    assert.equal(saved["acc1::<old-2020@test>"].receivedAt, Date.parse(oldDate));
  });

  it("respects disabled tracking settings and showBadgeCount toggle", async () => {
    const mock = createMockMessenger();
    globalThis.messenger = mock;

    const Store = require(STORE_PATH);
    mock._storageBacking[Store.SETTINGS_KEY] = {
      trackIncoming: false,
      trackTrash: false,
      trackPermanentDelete: false,
      showBadgeCount: false
    };

    const bg = require(BG_PATH);
    await new Promise((r) => setTimeout(r, 15));

    await mock._listeners.onNewMailReceived(mock._inboxFolder, {
      id: null,
      messages: [{ id: 1, headerMessageId: "<skip@test>", subject: "Skip", folder: mock._inboxFolder }]
    });
    await mock._listeners.onMoved(
      { id: null, messages: [{ id: 1, headerMessageId: "<skip@test>", folder: mock._inboxFolder }] },
      { id: null, messages: [{ id: 2, headerMessageId: "<skip@test>", folder: mock._trashFolder }] }
    );
    await mock._listeners.onDeleted({
      id: null,
      messages: [{ id: 2, headerMessageId: "<skip@test>", folder: mock._trashFolder }]
    });

    assert.equal(mock._storageBacking[Store.STORAGE_KEY], undefined);
    await bg.updateToolbarBadge();
    assert.equal(mock._badgeTexts.at(-1), "");
  });

  it("handles openDashboard message with view hint and falls back to tabs.create", async () => {
    const mock = createMockMessenger({
      existingSpaces: [{ id: 7, name: "mail_tarihce_gunlugu", isSelfOwned: true }]
    });
    globalThis.messenger = mock;

    require(STORE_PATH);
    const bg = require(BG_PATH);
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(mock._spaceCreates.length, 0);
    await mock._listeners.runtimeMessage({ type: "openDashboard", view: "settings" });
    assert.deepEqual(mock._spaceOpens, [7]);
    assert.equal(mock._storageBacking[bg.PENDING_VIEW_KEY], "settings");
    assert.deepEqual(mock._sentMessages, [{ type: "switchView", view: "settings" }]);

    // Fallback test without spaces.open
    delete require.cache[STORE_PATH];
    delete require.cache[BG_PATH];
    const mockFallback = createMockMessenger({ hasSpacesOpen: false });
    globalThis.messenger = mockFallback;

    require(STORE_PATH);
    require(BG_PATH);
    await new Promise((r) => setTimeout(r, 15));

    await mockFallback._listeners.runtimeMessage({ type: "openDashboard", view: "stats" });
    assert.equal(mockFallback._tabCreates.length, 1);
    assert.equal(
      mockFallback._tabCreates[0].url,
      "moz-extension://test-id/ui/dashboard.html#stats"
    );
  });
});
