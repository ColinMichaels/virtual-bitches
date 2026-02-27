import { environment } from "@env";
import { enUS, type TranslationKey } from "./locales/en-US.js";
import { esES } from "./locales/es-ES.js";

export type LocaleCode = "en-US" | "es-ES";

const LOCALE_STORAGE_KEY = `${environment.storage.prefix}-locale`;
const knownTranslationKeys = new Set<TranslationKey>(Object.keys(enUS) as TranslationKey[]);
const dictionaries: Record<LocaleCode, Record<TranslationKey, string>> = {
  "en-US": enUS,
  "es-ES": esES,
};

const localeListeners = new Set<(locale: LocaleCode) => void>();
let activeLocale: LocaleCode = resolveInitialLocale();

function resolveInitialLocale(): LocaleCode {
  const savedLocale = readSavedLocale();
  if (savedLocale) {
    return savedLocale;
  }

  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const browserLocale = normalizeLocaleCode(navigator.language);
    if (browserLocale) {
      return browserLocale;
    }
  }

  return "en-US";
}

function readSavedLocale(): LocaleCode | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const rawValue = localStorage.getItem(LOCALE_STORAGE_KEY);
  return normalizeLocaleCode(rawValue);
}

function normalizeLocaleCode(value: string | null | undefined): LocaleCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized in dictionaries) {
    return normalized as LocaleCode;
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith("en")) {
    return "en-US";
  }
  if (lower.startsWith("es")) {
    return "es-ES";
  }

  return null;
}

function applyDocumentLanguage(locale: LocaleCode): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = locale;
}

function formatTemplate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return "";
    }
    const value = params[name];
    return value === null || typeof value === "undefined" ? "" : String(value);
  });
}

export function getLocale(): LocaleCode {
  return activeLocale;
}

export function getSupportedLocales(): LocaleCode[] {
  return Object.keys(dictionaries) as LocaleCode[];
}

export function setLocale(locale: LocaleCode): void {
  if (activeLocale === locale) {
    return;
  }

  activeLocale = locale;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  applyDocumentLanguage(locale);
  localeListeners.forEach((listener) => {
    listener(locale);
  });
}

export function onLocaleChange(listener: (locale: LocaleCode) => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: LocaleCode = activeLocale
): string {
  const dictionary = dictionaries[locale] ?? dictionaries["en-US"];
  const template = dictionary[key] ?? dictionaries["en-US"][key] ?? key;
  return formatTemplate(template, params);
}

export function isTranslationKey(value: string): value is TranslationKey {
  return knownTranslationKeys.has(value as TranslationKey);
}

export function applyTranslationsToDom(root: ParentNode = document): void {
  if (typeof document === "undefined" || !root) {
    return;
  }

  applyAttributeTranslation(root, "data-i18n", (element, translated) => {
    element.textContent = translated;
  });
  applyAttributeTranslation(root, "data-i18n-title", (element, translated) => {
    element.setAttribute("title", translated);
  });
  applyAttributeTranslation(root, "data-i18n-aria-label", (element, translated) => {
    element.setAttribute("aria-label", translated);
  });
  applyAttributeTranslation(root, "data-i18n-placeholder", (element, translated) => {
    element.setAttribute("placeholder", translated);
  });
}

function applyAttributeTranslation(
  root: ParentNode,
  attributeName: string,
  apply: (element: Element, translated: string) => void
): void {
  const selector = `[${attributeName}]`;
  root.querySelectorAll(selector).forEach((element) => {
    const key = element.getAttribute(attributeName);
    if (!key) {
      return;
    }
    if (!isTranslationKey(key)) {
      if (environment.debug) {
        console.warn(`[i18n] Unknown translation key in ${attributeName}: ${key}`);
      }
      return;
    }
    apply(element, t(key));
  });
}

applyDocumentLanguage(activeLocale);
