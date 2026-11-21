"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const I18n = require("../src/i18n.js");

const EN_CATALOG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../_locales/en/messages.json"), "utf8")
);
const TR_CATALOG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../_locales/tr/messages.json"), "utf8")
);

describe("MailAuditI18n", () => {
  it("keeps English and Turkish locale catalogs in exact key parity", () => {
    const enKeys = Object.keys(EN_CATALOG).sort();
    const trKeys = Object.keys(TR_CATALOG).sort();
    assert.deepEqual(trKeys, enKeys);

    for (const key of enKeys) {
      assert.equal(typeof EN_CATALOG[key].message, "string");
      assert.ok(EN_CATALOG[key].message.length > 0, `Empty EN message for ${key}`);
      assert.equal(typeof TR_CATALOG[key].message, "string");
      assert.ok(TR_CATALOG[key].message.length > 0, `Empty TR message for ${key}`);
    }
  });

  it("detects Thunderbird UI language automatically and defaults unsupported locales to English", () => {
    assert.equal(I18n.detectThunderbirdLanguage({ i18n: { getUILanguage: () => "tr-TR" } }), "tr");
    assert.equal(I18n.detectThunderbirdLanguage({ i18n: { getUILanguage: () => "tr" } }), "tr");
    assert.equal(I18n.detectThunderbirdLanguage({ i18n: { getUILanguage: () => "en-US" } }), "en");
    assert.equal(I18n.detectThunderbirdLanguage({ i18n: { getUILanguage: () => "de-DE" } }), "en");
    assert.equal(I18n.detectThunderbirdLanguage({ i18n: { getUILanguage: () => "ja" } }), "en");
  });

  it("supports native auto lookup and explicit EN/TR overrides with positional substitutions", async () => {
    const mockApi = {
      i18n: {
        getUILanguage: () => "tr-TR",
        getMessage(key, subs) {
          const entry = TR_CATALOG[key];
          return entry ? I18n.formatMessageTemplate(entry.message, subs) : "";
        }
      }
    };

    const controller = I18n.createI18n(mockApi, {
      loadCatalog: async (lang) => (lang === "tr" ? TR_CATALOG : EN_CATALOG)
    });

    await controller.setPreference("auto");
    assert.equal(controller.getLanguage(), "tr");
    assert.equal(controller.getLocale(), "tr-TR");
    assert.equal(controller.t("navDeleted"), "Silinenler");
    assert.equal(controller.t("toastScanDone", [2, 50]), "2 klasörde 50 mail işlendi.");

    await controller.setPreference("en");
    assert.equal(controller.getLanguage(), "en");
    assert.equal(controller.getLocale(), "en-US");
    assert.equal(controller.t("navDeleted"), "Deleted");
    assert.equal(controller.t("toastScanDone", [2, 50]), "Indexed 50 messages across 2 folder(s).");
  });
});
