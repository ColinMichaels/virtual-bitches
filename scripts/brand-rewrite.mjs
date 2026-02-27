#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_REWRITE_INCLUDE_PATHS,
  classifyPath,
  listProjectFiles,
  normalizeMatcherPath,
  normalizeRelativePath,
  readTextFileSafe,
  rewriteBrandTokens,
} from "./brand-tools.mjs";

run();

function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.productName) {
    process.stderr.write(
      "[brand:rewrite] Missing required argument: --product-name \"Your Product Name\"\n"
    );
    process.exitCode = 1;
    return;
  }

  const rootDir = options.rootDir
    ? path.resolve(process.cwd(), options.rootDir)
    : process.cwd();
  const includePaths =
    options.includePaths.length > 0
      ? options.includePaths.map(normalizeMatcherPath).filter(Boolean)
      : DEFAULT_REWRITE_INCLUDE_PATHS;
  const excludePaths = options.excludePaths.map(normalizeMatcherPath).filter(Boolean);

  const files = listProjectFiles(rootDir);
  const touched = [];
  let protectedHits = 0;
  let outOfScopeHits = 0;
  let replaceableHits = 0;

  for (const file of files) {
    if (isExcluded(file, excludePaths)) {
      continue;
    }

    const absolute = path.join(rootDir, file);
    const content = readTextFileSafe(absolute);
    if (content === null) {
      continue;
    }

    const classification = classifyPath(file, includePaths);
    const rewritten = rewriteBrandTokens(content, options.productName);
    if (rewritten.replacementCount === 0) {
      continue;
    }

    if (classification === "protected") {
      protectedHits += rewritten.replacementCount;
      continue;
    }
    if (classification === "out_of_scope") {
      outOfScopeHits += rewritten.replacementCount;
      continue;
    }

    replaceableHits += rewritten.replacementCount;
    touched.push({
      file: normalizeRelativePath(file),
      absolute,
      replacementCount: rewritten.replacementCount,
      output: rewritten.output,
    });
  }

  if (options.jsonOutput) {
    process.stdout.write(
      `${JSON.stringify(
        {
          dryRun: !options.writeChanges,
          productName: options.productName,
          includePaths,
          excludePaths,
          totals: {
            filesChanged: touched.length,
            replaceableHits,
            protectedHits,
            outOfScopeHits,
          },
          files: touched.map((entry) => ({
            file: entry.file,
            replacementCount: entry.replacementCount,
          })),
        },
        null,
        2
      )}\n`
    );
  } else {
    printSummary({
      dryRun: !options.writeChanges,
      productName: options.productName,
      includePaths,
      excludePaths,
      touched,
      replaceableHits,
      protectedHits,
      outOfScopeHits,
    });
  }

  if (!options.writeChanges) {
    return;
  }

  for (const entry of touched) {
    writeFileSync(entry.absolute, entry.output, "utf8");
  }
}

function parseArgs(argv) {
  const options = {
    productName: "",
    rootDir: "",
    includePaths: [],
    excludePaths: [],
    writeChanges: false,
    jsonOutput: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--product-name") {
      options.productName = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (value === "--root") {
      options.rootDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (value === "--include") {
      const includeValue = String(argv[index + 1] || "").trim();
      if (includeValue) {
        options.includePaths.push(includeValue);
      }
      index += 1;
      continue;
    }
    if (value === "--exclude") {
      const excludeValue = String(argv[index + 1] || "").trim();
      if (excludeValue) {
        options.excludePaths.push(excludeValue);
      }
      index += 1;
      continue;
    }
    if (value === "--write") {
      options.writeChanges = true;
      continue;
    }
    if (value === "--json") {
      options.jsonOutput = true;
    }
  }

  return options;
}

function isExcluded(filePath, excludePaths) {
  const normalized = normalizeRelativePath(filePath);
  for (const matcher of excludePaths) {
    if (!matcher) {
      continue;
    }
    if (matcher.endsWith("/") && normalized.startsWith(matcher)) {
      return true;
    }
    if (normalized === matcher) {
      return true;
    }
  }
  return false;
}

function printSummary(payload) {
  process.stdout.write(
    `[brand:rewrite] mode=${payload.dryRun ? "dry-run" : "write"} ` +
      `productName="${payload.productName}"\n` +
      `[brand:rewrite] include paths: ${payload.includePaths.join(", ")}\n` +
      `[brand:rewrite] exclude paths: ${payload.excludePaths.length ? payload.excludePaths.join(", ") : "(none)"}\n` +
      `[brand:rewrite] replaceable matches=${payload.replaceableHits} ` +
      `protected matches skipped=${payload.protectedHits} ` +
      `out_of_scope matches skipped=${payload.outOfScopeHits}\n` +
      `[brand:rewrite] files ${payload.dryRun ? "to change" : "changed"}=${payload.touched.length}\n`
  );

  for (const entry of payload.touched.slice(0, 30)) {
    process.stdout.write(`  - ${entry.file}: ${entry.replacementCount}\n`);
  }
}
