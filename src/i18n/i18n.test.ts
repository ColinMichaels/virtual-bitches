import { getLocale, getSupportedLocales, setLocale, t } from "./index.js";
import { enUS } from "./locales/en-US.js";
import { esES } from "./locales/es-ES.js";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected "${expected}", got "${actual}"`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const originalLocale = getLocale();

test("supported locales include en-US and es-ES", () => {
  const locales = getSupportedLocales();
  assert(locales.includes("en-US"), "Missing en-US locale");
  assert(locales.includes("es-ES"), "Missing es-ES locale");
});

test("english translation resolves by default", () => {
  setLocale("en-US");
  assertEqual(t("pwa.install.installButton"), "Install");
});

test("spanish translation resolves when locale changes", () => {
  setLocale("es-ES");
  assertEqual(t("pwa.install.installButton"), "Instalar");
});

test("template interpolation fills named variables", () => {
  setLocale("en-US");
  assertEqual(
    t("loading.title", { productName: "Dice Party" }),
    "Loading Dice Party"
  );
});

test("locale dictionaries stay key-compatible", () => {
  const enKeys = Object.keys(enUS).sort().join("|");
  const esKeys = Object.keys(esES).sort().join("|");
  assertEqual(esKeys, enKeys, "Locale keys are out of sync between en-US and es-ES");
});

setLocale(originalLocale);

console.log("\ni18n tests passed.");
