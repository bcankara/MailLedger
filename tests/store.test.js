"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const Store = require("../src/store.js");

function makeMsg(overrides = {}) {
  return {
    id: 101,
    headerMessageId: "<msg-101@example.com>",
    subject: "Test Konusu",
    author: "Ahmet Yılmaz <ahmet@example.com>",
    date: new Date("2026-11-01T10:00:00Z"),
    folder: {
      id: "acc1://INBOX",
      accountId: "acc1",
      name: "Gelen Kutusu",
      path: "/INBOX",
      specialUse: ["inbox"]
    },
    ...overrides
  };
}

function makeMemoryStorageArea() {
  const backing = {};
  return {
    async get(key) {
      await new Promise((r) => setTimeout(r, 2));
      if (typeof key === "string") {
        return { [key]: backing[key] };
      }
      return { ...backing };
    },
    async set(obj) {
      await new Promise((r) => setTimeout(r, 2));
      Object.assign(backing, obj);
    }
  };
}

describe("makeRecordKey", () => {
  it("uses accountId and trimmed headerMessageId when present", () => {
    const key = Store.makeRecordKey(makeMsg({ headerMessageId: "  <abc@mail.test>  " }));
    assert.equal(key, "acc1::<abc@mail.test>");
  });

  it("falls back to composite metadata when headerMessageId is missing", () => {
    const date = new Date("2024-05-10T08:30:00Z");
    const key = Store.makeRecordKey(makeMsg({
      headerMessageId: "",
      subject: "Fatura",
      author: "billing@example.com",
      date
    }));
    assert.equal(key, `acc1::fallback::${date.getTime()}::billing@example.com::Fatura`);
  });

  it("separates identical headerMessageId across different accounts", () => {
    const key1 = Store.makeRecordKey(makeMsg({
      folder: { id: "acc1://INBOX", accountId: "acc1" }
    }));
    const key2 = Store.makeRecordKey(makeMsg({
      folder: { id: "acc2://INBOX", accountId: "acc2" }
    }));
    assert.notEqual(key1, key2);
    assert.equal(key1, "acc1::<msg-101@example.com>");
    assert.equal(key2, "acc2::<msg-101@example.com>");
  });
});

describe("applyIncomingMessages", () => {
  const inboxFolder = {
    id: "acc1://INBOX",
    accountId: "acc1",
    name: "Gelen Kutusu",
    path: "/INBOX",
    specialUse: ["inbox"]
  };
  const trashFolder = {
    id: "acc1://[Gmail]/Trash",
    accountId: "acc1",
    name: "Çöp Kutusu",
    path: "/[Gmail]/Çöp Kutusu",
    specialUse: ["trash"]
  };
  const ctx = {
    now: 1700000000000,
    accountNames: { acc1: "Kişisel Gmail" },
    trashFolderIds: new Set(["acc1://[Gmail]/Trash"])
  };

  it("records normal inbox arrival as active", () => {
    const map = Store.applyIncomingMessages({}, [makeMsg()], inboxFolder, ctx);
    const rec = map["acc1::<msg-101@example.com>"];
    assert.ok(rec);
    assert.equal(rec.status, "active");
    assert.equal(rec.deletedAt, null);
    assert.equal(rec.accountName, "Kişisel Gmail");
    assert.equal(rec.originalFolderPath, "INBOX");
  });

  it("records direct-to-trash arrival as trashed with deletedAt", () => {
    const msg = makeMsg({ id: 202, folder: trashFolder });
    const map = Store.applyIncomingMessages({}, [msg], trashFolder, ctx);
    const rec = map["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "trashed");
    assert.equal(rec.deletedAt, 1700000000000);
    assert.equal(rec.originalFolderId, null);
  });

  it("deduplicates without clobbering existing trashed or deleted state", () => {
    const existing = {
      "acc1::<msg-101@example.com>": {
        key: "acc1::<msg-101@example.com>",
        headerMessageId: "<msg-101@example.com>",
        subject: "Test Konusu",
        author: "Ahmet",
        accountId: "acc1",
        accountName: "Eski Ad",
        receivedAt: 1600000000000,
        recordedAt: 1600000001000,
        status: "trashed",
        deletedAt: 1650000000000,
        permanentlyDeletedAt: null,
        restoredAt: null,
        preExistingTrash: false,
        originalFolderId: "acc1://INBOX",
        originalFolderPath: "INBOX",
        currentFolderId: "acc1://[Gmail]/Trash",
        currentFolderPath: "[Gmail]/Çöp Kutusu",
        lastMessageId: 10
      }
    };

    const next = Store.applyIncomingMessages(
      existing,
      [makeMsg({ id: 999, folder: inboxFolder })],
      inboxFolder,
      ctx
    );
    const rec = next["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "trashed");
    assert.equal(rec.deletedAt, 1650000000000);
    assert.equal(rec.lastMessageId, 999);
    assert.equal(rec.accountName, "Kişisel Gmail");
  });
});

describe("applyScannedTrashMessages", () => {
  const trashFolder = {
    id: "acc1://[Gmail]/Trash",
    accountId: "acc1",
    name: "Çöp Kutusu",
    path: "/[Gmail]/Çöp Kutusu",
    specialUse: ["trash"]
  };

  it("marks untracked trash messages as preExistingTrash with null deletedAt", () => {
    const msg = makeMsg({ id: 303, headerMessageId: "<pre-trash@test>", folder: trashFolder });
    const next = Store.applyScannedTrashMessages({}, [msg], trashFolder, {
      now: 2000,
      accountNames: { acc1: "Gmail" }
    });
    const rec = next["acc1::<pre-trash@test>"];
    assert.equal(rec.status, "trashed");
    assert.equal(rec.deletedAt, null);
    assert.equal(rec.preExistingTrash, true);
  });

  it("preserves real deletedAt if message was already tracked", () => {
    const existing = {
      "acc1::<tracked-trash@test>": {
        key: "acc1::<tracked-trash@test>",
        headerMessageId: "<tracked-trash@test>",
        subject: "Sözleşme",
        author: "A",
        accountId: "acc1",
        accountName: "Gmail",
        receivedAt: 1000,
        recordedAt: 1000,
        status: "trashed",
        deletedAt: 5555,
        permanentlyDeletedAt: null,
        restoredAt: null,
        preExistingTrash: false,
        originalFolderId: "acc1://INBOX",
        originalFolderPath: "INBOX",
        currentFolderId: trashFolder.id,
        currentFolderPath: "[Gmail]/Çöp Kutusu",
        lastMessageId: 1
      }
    };
    const msg = makeMsg({ id: 404, headerMessageId: "<tracked-trash@test>", folder: trashFolder });
    const next = Store.applyScannedTrashMessages(existing, [msg], trashFolder, {
      now: 9999,
      accountNames: { acc1: "Gmail" }
    });
    const rec = next["acc1::<tracked-trash@test>"];
    assert.equal(rec.deletedAt, 5555);
    assert.equal(rec.preExistingTrash, false);
    assert.equal(rec.lastMessageId, 404);
  });
});

describe("applyMovedMessages", () => {
  const inboxFolder = {
    id: "acc1://INBOX",
    accountId: "acc1",
    name: "Gelen Kutusu",
    path: "/INBOX",
    specialUse: ["inbox"]
  };
  const archiveFolder = {
    id: "acc1://Archive",
    accountId: "acc1",
    name: "Arşiv",
    path: "/Archive",
    specialUse: ["archive"]
  };
  const trashFolder = {
    id: "acc1://[Gmail]/Trash",
    accountId: "acc1",
    name: "Çöp Kutusu",
    path: "/[Gmail]/Çöp Kutusu",
    specialUse: ["trash"]
  };
  const ctxBase = {
    accountNames: { acc1: "Gmail" },
    trashFolderIds: new Set(["acc1://[Gmail]/Trash"])
  };

  it("marks tracked mail as trashed and preserves originalFolderId", () => {
    const initial = Store.applyIncomingMessages({}, [makeMsg()], inboxFolder, {
      ...ctxBase,
      now: 1000
    });
    const moved = Store.applyMovedMessages(
      initial,
      [
        {
          originalMsg: makeMsg({ id: 101, folder: inboxFolder }),
          movedMsg: makeMsg({ id: 505, folder: trashFolder })
        }
      ],
      { ...ctxBase, now: 5000 }
    );
    const rec = moved["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "trashed");
    assert.equal(rec.deletedAt, 5000);
    assert.equal(rec.originalFolderId, "acc1://INBOX");
    assert.equal(rec.currentFolderId, "acc1://[Gmail]/Trash");
    assert.equal(rec.lastMessageId, 505);
  });

  it("creates a new trashed record for an untracked old email while preserving its old receivedAt", () => {
    const oldDate = new Date("2021-03-14T12:00:00Z");
    const moved = Store.applyMovedMessages(
      {},
      [
        {
          originalMsg: makeMsg({
            id: 77,
            headerMessageId: "<old-2021@example.com>",
            subject: "2021 Eski Mail",
            date: oldDate,
            folder: inboxFolder
          }),
          movedMsg: makeMsg({
            id: 88,
            headerMessageId: "<old-2021@example.com>",
            subject: "2021 Eski Mail",
            date: oldDate,
            folder: trashFolder
          })
        }
      ],
      { ...ctxBase, now: 900000 }
    );
    const rec = moved["acc1::<old-2021@example.com>"];
    assert.ok(rec);
    assert.equal(rec.status, "trashed");
    assert.equal(rec.receivedAt, oldDate.getTime());
    assert.equal(rec.deletedAt, 900000);
    assert.equal(rec.originalFolderPath, "INBOX");
  });

  it("restores a mail moved out of Trash back to active", () => {
    const trashed = Store.applyMovedMessages(
      {},
      [
        {
          originalMsg: makeMsg({ id: 10, folder: inboxFolder }),
          movedMsg: makeMsg({ id: 20, folder: trashFolder })
        }
      ],
      { ...ctxBase, now: 5000 }
    );

    const restored = Store.applyMovedMessages(
      trashed,
      [
        {
          originalMsg: makeMsg({ id: 20, folder: trashFolder }),
          movedMsg: makeMsg({ id: 30, folder: inboxFolder })
        }
      ],
      { ...ctxBase, now: 9000 }
    );

    const rec = restored["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "active");
    assert.equal(rec.deletedAt, null);
    assert.equal(rec.restoredAt, 9000);
    assert.equal(rec.currentFolderId, "acc1://INBOX");
    assert.equal(rec.lastMessageId, 30);
  });

  it("updates tracked mail on normal folder move and ignores untracked mail", () => {
    const tracked = Store.applyIncomingMessages({}, [makeMsg()], inboxFolder, {
      ...ctxBase,
      now: 1000
    });
    const untrackedMove = {
      originalMsg: makeMsg({
        id: 222,
        headerMessageId: "<untracked@example.com>",
        folder: inboxFolder
      }),
      movedMsg: makeMsg({
        id: 223,
        headerMessageId: "<untracked@example.com>",
        folder: archiveFolder
      })
    };
    const trackedMove = {
      originalMsg: makeMsg({ id: 101, folder: inboxFolder }),
      movedMsg: makeMsg({ id: 102, folder: archiveFolder })
    };

    const next = Store.applyMovedMessages(tracked, [trackedMove, untrackedMove], {
      ...ctxBase,
      now: 2000
    });
    assert.equal(next["acc1::<msg-101@example.com>"].currentFolderPath, "Archive");
    assert.equal(next["acc1::<msg-101@example.com>"].lastMessageId, 102);
    assert.equal(next["acc1::<untracked@example.com>"], undefined);
  });
});

describe("applyDeletedMessages", () => {
  it("preserves original deletedAt when purging an already-trashed mail", () => {
    const existing = {
      "acc1::<msg-101@example.com>": {
        key: "acc1::<msg-101@example.com>",
        headerMessageId: "<msg-101@example.com>",
        subject: "Test",
        author: "A",
        accountId: "acc1",
        accountName: "Gmail",
        receivedAt: 1000,
        recordedAt: 1000,
        status: "trashed",
        deletedAt: 5000,
        permanentlyDeletedAt: null,
        restoredAt: null,
        preExistingTrash: false,
        originalFolderId: "acc1://INBOX",
        originalFolderPath: "INBOX",
        currentFolderId: "acc1://Trash",
        currentFolderPath: "Trash",
        lastMessageId: 50
      }
    };
    const next = Store.applyDeletedMessages(existing, [makeMsg()], {
      now: 9000,
      accountNames: { acc1: "Gmail" }
    });
    const rec = next["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "deleted");
    assert.equal(rec.deletedAt, 5000);
    assert.equal(rec.permanentlyDeletedAt, 9000);
    assert.equal(rec.currentFolderId, null);
  });

  it("sets both deletedAt and permanentlyDeletedAt on direct permanent delete", () => {
    const next = Store.applyDeletedMessages({}, [makeMsg()], {
      now: 7777,
      accountNames: { acc1: "Gmail" }
    });
    const rec = next["acc1::<msg-101@example.com>"];
    assert.equal(rec.status, "deleted");
    assert.equal(rec.deletedAt, 7777);
    assert.equal(rec.permanentlyDeletedAt, 7777);
  });
});

describe("filterAndSortRecords", () => {
  const sample = [
    {
      key: "1",
      subject: "İSTANBUL FATURASI",
      author: "ayse@firma.com",
      accountId: "acc1",
      accountName: "İş",
      status: "trashed",
      receivedAt: new Date(2025, 0, 10, 12, 0, 0).getTime(),
      deletedAt: new Date(2026, 10, 15, 10, 0, 0).getTime(),
      recordedAt: 100
    },
    {
      key: "2",
      subject: "Işıklandırma Teklifi",
      author: "veli@firma.com",
      accountId: "acc2",
      accountName: "Kişisel",
      status: "deleted",
      receivedAt: new Date(2026, 5, 20, 14, 0, 0).getTime(),
      deletedAt: new Date(2026, 10, 20, 18, 0, 0).getTime(),
      recordedAt: 200
    },
    {
      key: "3",
      subject: "Aktif Bülten",
      author: "news@firma.com",
      accountId: "acc1",
      accountName: "İş",
      status: "active",
      receivedAt: new Date(2026, 10, 21, 9, 0, 0).getTime(),
      deletedAt: null,
      recordedAt: 300
    }
  ];

  it("performs Turkish case-insensitive search including İ/i and I/ı", () => {
    const res1 = Store.filterAndSortRecords(sample, { search: "istanbul" });
    assert.deepEqual(res1.map((r) => r.key), ["1"]);

    const res2 = Store.filterAndSortRecords(sample, { search: "ışık" });
    assert.deepEqual(res2.map((r) => r.key), ["2"]);
  });

  it("filters by status, accountId, and date range", () => {
    assert.deepEqual(
      Store.filterAndSortRecords(sample, { status: "deleted_any" }).map((r) => r.key),
      ["2", "1"]
    );
    assert.deepEqual(
      Store.filterAndSortRecords(sample, {
        dateField: "deletedAt",
        dateFrom: "2026-11-18",
        dateTo: "2026-11-21"
      }).map((r) => r.key),
      ["2"]
    );
    assert.deepEqual(
      Store.filterAndSortRecords(sample, {
        dateField: "receivedAt",
        dateFrom: "2025-01-01",
        dateTo: "2025-12-31"
      }).map((r) => r.key),
      ["1"]
    );
  });

  it("always places null deletedAt last in both asc and desc sorts", () => {
    const desc = Store.filterAndSortRecords(sample, { sortBy: "deletedAt", sortDir: "desc" });
    assert.deepEqual(desc.map((r) => r.key), ["2", "1", "3"]);

    const asc = Store.filterAndSortRecords(sample, { sortBy: "deletedAt", sortDir: "asc" });
    assert.deepEqual(asc.map((r) => r.key), ["1", "2", "3"]);
  });
});

describe("computeStatistics", () => {
  it("computes counts, today deletions, account breakdown, top folders, and 14-day timeline", () => {
    const now = new Date(2026, 10, 21, 12, 0, 0).getTime();
    const yesterday = new Date(2026, 10, 20, 15, 0, 0).getTime();

    const stats = Store.computeStatistics(
      [
        {
          key: "1",
          accountId: "acc1",
          accountName: "Gmail",
          status: "trashed",
          deletedAt: now - 3600000,
          originalFolderPath: "INBOX"
        },
        {
          key: "2",
          accountId: "acc1",
          accountName: "Gmail",
          status: "deleted",
          deletedAt: yesterday,
          originalFolderPath: "INBOX"
        },
        {
          key: "3",
          accountId: "acc2",
          accountName: "İş",
          status: "active",
          deletedAt: null,
          originalFolderPath: "Faturalar"
        }
      ],
      now
    );

    assert.equal(stats.total, 3);
    assert.equal(stats.trashed, 1);
    assert.equal(stats.deleted, 1);
    assert.equal(stats.active, 1);
    assert.equal(stats.deletedToday, 1);
    assert.equal(stats.byAccount[0].accountName, "Gmail");
    assert.equal(stats.byAccount[0].total, 2);
    assert.equal(stats.topDeletedFolders[0].folder, "INBOX");
    assert.equal(stats.topDeletedFolders[0].count, 2);
    assert.equal(stats.dailyDeletions.length, 14);
    assert.equal(stats.dailyDeletions[13].count, 1);
    assert.equal(stats.dailyDeletions[12].count, 1);
  });
});

describe("importRecordsFromJson", () => {
  it("merges backup records safely and blocks prototype pollution keys", () => {
    const existing = {
      "acc1::<k1>": {
        key: "acc1::<k1>",
        headerMessageId: "<k1>",
        subject: "Eski",
        author: "a@test",
        accountId: "acc1",
        accountName: "Gmail",
        receivedAt: 1000,
        recordedAt: 1000,
        status: "active",
        deletedAt: null,
        permanentlyDeletedAt: null,
        restoredAt: null,
        preExistingTrash: false,
        originalFolderId: "acc1://INBOX",
        originalFolderPath: "INBOX",
        currentFolderId: "acc1://INBOX",
        currentFolderPath: "INBOX",
        lastMessageId: 1
      }
    };

    const json = JSON.stringify({
      version: "1.1.0",
      records: [
        {
          key: "__proto__",
          subject: "Malicious"
        },
        {
          key: "acc1::<k1>",
          headerMessageId: "<k1>",
          subject: "Eski",
          status: "trashed",
          deletedAt: 9000
        },
        {
          key: "acc1::<k2>",
          headerMessageId: "<k2>",
          subject: "Yeni Yedek Kaydı",
          author: "b@test",
          accountId: "acc1",
          status: "deleted",
          receivedAt: 500,
          deletedAt: 8000
        }
      ]
    });

    const res = Store.importRecordsFromJson(json, existing);
    assert.equal(res.importedCount, 1);
    assert.equal(res.updatedCount, 1);
    assert.equal(res.skippedCount, 1);
    assert.equal(res.recordsMap["acc1::<k1>"].status, "trashed");
    assert.equal(res.recordsMap["acc1::<k1>"].deletedAt, 9000);
    assert.equal(res.recordsMap["acc1::<k2>"].subject, "Yeni Yedek Kaydı");
    assert.equal(Object.prototype.hasOwnProperty.call(res.recordsMap, "__proto__"), false);
  });
});

describe("exportRecordsToCsv", () => {
  it("prepends UTF-8 BOM, escapes RFC 4180 cells, and labels pre-existing trash", () => {
    const csv = Store.exportRecordsToCsv([
      {
        status: "trashed",
        subject: 'Teklif, "Özel"\nRevize',
        author: "Ali <ali@test.com>",
        accountName: "Gmail",
        receivedAt: Date.UTC(2026, 0, 15, 10, 0, 0),
        deletedAt: null,
        preExistingTrash: true,
        permanentlyDeletedAt: null,
        originalFolderPath: "",
        currentFolderPath: "[Gmail]/Çöp Kutusu",
        headerMessageId: "<id@test>"
      }
    ]);

    assert.equal(csv.startsWith("\uFEFF"), true);
    assert.ok(csv.includes('"Teklif, ""Özel""\nRevize"'));
    assert.ok(csv.includes("Kurulum öncesi"));
  });
});

describe("pruneRecords", () => {
  it("evicts oldest active records before trashed or deleted records", () => {
    const map = {
      a1: { key: "a1", status: "active", receivedAt: 100, recordedAt: 100 },
      a2: { key: "a2", status: "active", receivedAt: 200, recordedAt: 200 },
      t1: { key: "t1", status: "trashed", receivedAt: 50, deletedAt: 500, recordedAt: 50 },
      d1: { key: "d1", status: "deleted", receivedAt: 60, deletedAt: 600, recordedAt: 60 }
    };

    const pruned = Store.pruneRecords(map, 2);
    assert.deepEqual(Object.keys(pruned).sort(), ["d1", "t1"]);
  });
});

describe("createStorageManager concurrency & bulk operations", () => {
  it("serializes concurrent updateRecords calls and supports removeRecordsBulk & settings", async () => {
    const area = makeMemoryStorageArea();
    const mgr = Store.createStorageManager(area);

    await Promise.all([
      mgr.updateRecords((map) => ({ ...map, k1: { key: "k1", status: "active", receivedAt: 1 } })),
      mgr.updateRecords((map) => ({ ...map, k2: { key: "k2", status: "trashed", deletedAt: 2 } })),
      mgr.updateRecords((map) => ({ ...map, k3: { key: "k3", status: "deleted", deletedAt: 3 } }))
    ]);

    let finalMap = await mgr.getRecordsMap();
    assert.deepEqual(Object.keys(finalMap).sort(), ["k1", "k2", "k3"]);

    await mgr.removeRecordsBulk(["k1", "k3"]);
    finalMap = await mgr.getRecordsMap();
    assert.deepEqual(Object.keys(finalMap), ["k2"]);

    const savedSettings = await mgr.saveSettings({ theme: "dark", trackIncoming: false });
    assert.equal(savedSettings.theme, "dark");
    assert.equal(savedSettings.trackIncoming, false);
    assert.equal(savedSettings.trackTrash, true);
  });
});
