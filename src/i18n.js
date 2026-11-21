(function initMailAuditI18n(root) {
  "use strict";

  const SUPPORTED_LANGUAGES = new Set(["en", "tr"]);

  /**
   * Detect the active Thunderbird UI language and map to supported extension locales.
   * Defaults to English ("en") unless Thunderbird runs in Turkish ("tr").
   * @param {object|null|undefined} api
   * @returns {"en"|"tr"}
   */
  function detectThunderbirdLanguage(api) {
    let raw = "";
    try {
      if (api?.i18n && typeof api.i18n.getUILanguage === "function") {
        raw = String(api.i18n.getUILanguage() || "");
      } else if (typeof navigator !== "undefined" && navigator.language) {
        raw = String(navigator.language || "");
      }
    } catch (_err) {
      raw = "";
    }
    const base = raw.trim().toLowerCase().split(/[-_]/)[0];
    return SUPPORTED_LANGUAGES.has(base) ? base : "en";
  }

  /**
   * Resolve user preference ("auto" | "en" | "tr") into an effective locale code.
   * @param {string|null|undefined} preference
   * @param {object|null|undefined} api
   * @returns {"en"|"tr"}
   */
  function resolveEffectiveLanguage(preference, api) {
    if (preference === "tr" || preference === "en") {
      return preference;
    }
    return detectThunderbirdLanguage(api);
  }

  /**
   * Map extension language code to an Intl locale identifier.
   * @param {string} lang
   * @returns {string}
   */
  function getIntlLocale(lang) {
    return lang === "tr" ? "tr-TR" : "en-US";
  }

  /**
   * Format a WebExtension messages.json template with positional $1..$9 substitutions.
   * @param {string} template
   * @param {string|number|Array<string|number>|undefined} substitutions
   * @returns {string}
   */
  function formatMessageTemplate(template, substitutions) {
    if (typeof template !== "string") {
      return "";
    }
    const list = substitutions === undefined || substitutions === null
      ? []
      : (Array.isArray(substitutions) ? substitutions : [substitutions]);

    return template.replace(/\$\$|\$([1-9])/g, (match, indexStr) => {
      if (match === "$$") {
        return "$";
      }
      const idx = Number(indexStr) - 1;
      return idx >= 0 && idx < list.length && list[idx] !== undefined && list[idx] !== null
        ? String(list[idx])
        : "";
    });
  }

  /**
   * Create a runtime localization controller backed by Thunderbird's native _locales
   * (when preference is "auto") and on-demand _locales/<lang>/messages.json loading
   * when the user explicitly overrides the language in Settings.
   * @param {object} api
   * @param {{ loadCatalog?: (lang: string) => Promise<object|null> }} opts
   */
  function createI18n(api, opts = {}) {
    let preference = "auto";
    let activeLang = detectThunderbirdLanguage(api);
    let overrideCatalog = null;
    const catalogCache = new Map();

    async function fetchCatalog(lang) {
      if (catalogCache.has(lang)) {
        return catalogCache.get(lang);
      }
      if (typeof opts.loadCatalog === "function") {
        const custom = await opts.loadCatalog(lang);
        if (custom) {
          catalogCache.set(lang, custom);
        }
        return custom || null;
      }
      if (typeof fetch === "function" && api?.runtime?.getURL) {
        const url = api.runtime.getURL(`_locales/${lang}/messages.json`);
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          catalogCache.set(lang, json);
          return json;
        }
      }
      return null;
    }

    async function setPreference(nextPref) {
      preference = nextPref === "tr" || nextPref === "en" ? nextPref : "auto";
      activeLang = resolveEffectiveLanguage(preference, api);

      if (preference === "auto") {
        overrideCatalog = null;
      } else {
        try {
          overrideCatalog = await fetchCatalog(activeLang);
        } catch (_err) {
          overrideCatalog = null;
        }
      }

      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.lang = activeLang;
      }
      return activeLang;
    }

    function t(key, substitutions) {
      if (!key) {
        return "";
      }
      if (overrideCatalog && Object.prototype.hasOwnProperty.call(overrideCatalog, key)) {
        const entry = overrideCatalog[key];
        if (entry && typeof entry.message === "string") {
          return formatMessageTemplate(entry.message, substitutions);
        }
      }
      if (api?.i18n && typeof api.i18n.getMessage === "function") {
        const subs = substitutions === undefined || substitutions === null
          ? undefined
          : (Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)]);
        const nativeVal = api.i18n.getMessage(key, subs);
        if (nativeVal) {
          return nativeVal;
        }
      }
      return key;
    }

    function getLanguage() {
      return activeLang;
    }

    function getLocale() {
      return getIntlLocale(activeLang);
    }

    function applyDom(rootNode) {
      const target = rootNode || (typeof document !== "undefined" ? document : null);
      if (!target) {
        return;
      }
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.lang = activeLang;
      }

      for (const el of target.querySelectorAll("[data-i18n]")) {
        const key = el.getAttribute("data-i18n");
        const val = t(key);
        if (val) {
          el.textContent = val;
        }
      }
      for (const el of target.querySelectorAll("[data-i18n-placeholder]")) {
        const key = el.getAttribute("data-i18n-placeholder");
        const val = t(key);
        if (val) {
          el.setAttribute("placeholder", val);
        }
      }
      for (const el of target.querySelectorAll("[data-i18n-aria-label]")) {
        const key = el.getAttribute("data-i18n-aria-label");
        const val = t(key);
        if (val) {
          el.setAttribute("aria-label", val);
        }
      }
      for (const el of target.querySelectorAll("[data-i18n-title]")) {
        const key = el.getAttribute("data-i18n-title");
        const val = t(key);
        if (val) {
          el.setAttribute("title", val);
        }
      }
    }

    function buildCsvLabels() {
      return {
        headers: [
          t("csvHeaderStatus"),
          t("csvHeaderSubject"),
          t("csvHeaderSender"),
          t("csvHeaderAccount"),
          t("csvHeaderReceived"),
          t("csvHeaderDeleted"),
          t("csvHeaderPermDeleted"),
          t("csvHeaderOrigFolder"),
          t("csvHeaderCurrFolder"),
          t("csvHeaderMessageId")
        ],
        statuses: {
          trashed: t("statusTrashed"),
          deleted: t("statusDeleted"),
          active: t("statusActive")
        },
        preExistingTrash: t("preExistingTrash")
      };
    }

    return {
      setPreference,
      t,
      getLanguage,
      getLocale,
      applyDom,
      buildCsvLabels
    };
  }

  const MailAuditI18n = {
    SUPPORTED_LANGUAGES,
    detectThunderbirdLanguage,
    resolveEffectiveLanguage,
    getIntlLocale,
    formatMessageTemplate,
    createI18n
  };

  root.MailAuditI18n = MailAuditI18n;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MailAuditI18n;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
