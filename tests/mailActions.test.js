"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const Store = require("../src/store.js");
const Actions = require("../src/mailActions.js");

function createMockApi() {
  const opened = [];
  const moves = [];
  const storageBacking = {};

  const inboxFolder = {
    id: "acc1://INBOX",
    accountId: "acc1",
    name: "Gelen Kutusu",
    path: "/INBOX",
    specialUse: ["inbox"]
  };
  const customFolder = {
    id: "acc1://Projeler",
    accountId: "acc1",
    name: "Projeler",
    path: "/Projeler",
    specialUse: []
  };
  const trashFolder = {
    id: "acc1://[Gmail]/Trash",
    accountId: "acc1",
    name: "Çöp Kutusu",
    path: "/[Gmail]/Çöp Kutusu",
    specialUse: ["trash"]
  };

  const foldersById = new Map([
    [inboxFolder.id, inboxFolder],
    [customFolder.id, customFolder],
    [trashFolder.id, trashFolder]
  ]);

  const liveMessages = [
    {
      id: 700,
      headerMessageId: "<m-700@test>",
      subject: "Silinen Eski Mail",
      author: "ali@test.com",
      date: "2022-05-01T10:00:00Z",
      folder: trashFolder
    }
  ];

  const api = {
    _opened: opened,
    _moves: moves,
    _foldersById: foldersById,
    _liveMessages: liveMessages,
    _inboxFolder: inboxFolder,
    _trashFolder: trashFolder,

    accounts: {
      async list() {
        return [{ id: "acc1", name: "Kişisel Gmail" }];
      }
    },
    folders: {
      async get(folderId) {
        if (!foldersById.has(folderId)) {
          throw new Error("Folder not found");
        }
        return foldersById.get(folderId);
      },
      async query(info) {
        const all = Array.from(foldersById.values());
        return all.filter((f) => {
          if (info?.accountId && f.accountId !== info.accountId) return false;
          if (info?.specialUse) {
            return info.specialUse.every((u) => Array.isArray(f.specialUse) && f.specialUse.includes(u));
          }
          return true;
        });
      }
    },
    messages: {
      async query({ headerMessageId, folderId }) {
        const matches = liveMessages.filter((m) => {
          if (headerMessageId && m.headerMessageId !== headerMessageId) return false;
          if (folderId && m.folder.id !== folderId) return false;
          return true;
        });
        return { id: null, messages: matches };
      },
      async get(id) {
        return liveMessages.find((m) => m.id === id) || null;
      },
      async list(folderId) {
        if (folderId === inboxFolder.id) {
          return {
            id: "inbox-page-2",
            messages: [
              {
                id: 10,
                headerMessageId: "<in-old@test>",
                subject: "Eski Gelen",
                author: "old@test",
                date: "2024-01-01T00:00:00Z",
                folder: inboxFolder
              }
            ]
          };
        }
        if (folderId === trashFolder.id) {
          return {
            id: null,
            messages: [
              {
                id: 700,
                headerMessageId: "<m-700@test>",
                subject: "Silinen Eski Mail",
                author: "ali@test.com",
                date: "2022-05-01T10:00:00Z",
                folder: trashFolder
              }
            ]
          };
        }
        return { id: null, messages: [] };
      },
      async continueList(pageId) {
        if (pageId === "inbox-page-2") {
          return {
            id: null,
            messages: [
              {
                id: 11,
                headerMessageId: "<in-new@test>",
                subject: "Yeni Gelen",
                author: "new@test",
                date: "2026-11-20T12:00:00Z",
                folder: inboxFolder
              }
            ]
          };
        }
        return { id: null, messages: [] };
      },
      async move(ids, destinationFolderId) {
        assert.equal(typeof destinationFolderId, "string", "MV3 messages.move requires MailFolderId string");
        moves.push({ ids, destinationFolderId });
      }
    },
    messageDisplay: {
      async open(opts) {
        opened.push(opts);
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: storageBacking[key] };
        },
        async set(obj) {
          Object.assign(storageBacking, obj);
        }
      }
    }
  };

  return api;
}

describe("MailAuditActions", () => {
  it("opens an existing message and reports missing messages cleanly", async () => {
    const api = createMockApi();
    const okRes = await Actions.openMessage(api, {
      headerMessageId: "<m-700@test>",
      accountId: "acc1",
      currentFolderId: api._trashFolder.id
    });
    assert.equal(okRes.ok, true);
    assert.deepEqual(api._opened, [{ messageId: 700, active: true }]);

    const missRes = await Actions.openMessage(api, {
      headerMessageId: "<missing@test>",
      accountId: "acc1"
    });
    assert.equal(missRes.ok, false);
    assert.ok(missRes.error.includes("bulunamadı"));
  });

  it("restores trashed message to original folder, falling back to account Inbox if deleted", async () => {
    const api = createMockApi();
    const res1 = await Actions.restoreMessage(api, Store, {
      headerMessageId: "<m-700@test>",
      accountId: "acc1",
      originalFolderId: "acc1://Projeler",
      currentFolderId: api._trashFolder.id
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.targetFolderId, "acc1://Projeler");

    // Delete custom folder and verify Inbox fallback
    api._foldersById.delete("acc1://Projeler");
    const res2 = await Actions.restoreMessage(api, Store, {
      headerMessageId: "<m-700@test>",
      accountId: "acc1",
      originalFolderId: "acc1://Projeler",
      currentFolderId: api._trashFolder.id
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.targetFolderId, "acc1://INBOX");
    assert.equal(api._moves.length, 2);
  });

  it("scans Inbox (keeping newest maxKeep) and Trash (marking preExistingTrash)", async () => {
    const api = createMockApi();
    const mgr = Store.createStorageManager(api.storage.local);
    const progressEvents = [];

    const inboxSummary = await Actions.scanFoldersByUse(api, Store, mgr, {
      specialUse: "inbox",
      maxKeep: 1,
      onProgress: (p) => progressEvents.push(p)
    });
    assert.equal(inboxSummary.folderCount, 1);
    assert.equal(inboxSummary.messageCount, 1);
    assert.equal(progressEvents.length, 1);

    let map = await mgr.getRecordsMap();
    assert.ok(map["acc1::<in-new@test>"]);
    assert.equal(map["acc1::<in-old@test>"], undefined);

    const trashSummary = await Actions.scanFoldersByUse(api, Store, mgr, {
      specialUse: "trash",
      maxKeep: 10
    });
    assert.equal(trashSummary.folderCount, 1);
    assert.equal(trashSummary.messageCount, 1);

    map = await mgr.getRecordsMap();
    assert.equal(map["acc1::<m-700@test>"].status, "trashed");
    assert.equal(map["acc1::<m-700@test>"].deletedAt, null);
    assert.equal(map["acc1::<m-700@test>"].preExistingTrash, true);
  });
});
