#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import {
  DEFAULT_REWRITE_INCLUDE_PATHS,
  classifyPath,
  findBrandMatches,
  listProjectFiles,
  normalizeMatcherPath,
  normalizeRelativePath,
  readTextFileSafe,
} from "./brand-tools.mjs";

run();

function run() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = options.rootDir
    ? path.resolve(process.cwd(), options.rootDir)
    : process.cwd();
  const includePaths =
    options.includePaths.length > 0
      ? options.includePaths.map(normalizeMatcherPath).filter(Boolean)
      : DEFAULT_REWRITE_INCLUDE_PATHS;

  const files = listProjectFiles(rootDir);
  const findings = [];

  for (const file of files) {
    const absolute = path.join(rootDir, file);
    const content = readTextFileSafe(absolute);
    if (content === null) {
      continue;
    }
    const matches = findBrandMatches(content);
    if (matches.length === 0) {
      continue;
    }
    const classification = classifyPath(file, includePaths);
    for (const match of matches) {
      findings.push({
        file: normalizeRelativePath(file),
        line: match.line,
        column: match.column,
        token: match.token,
        classification,
      });
    }
  }

  const grouped = summarize(findings);
  if (options.jsonOutput) {
    process.stdout.write(
      `${JSON.stringify(
        {
          rootDir: normalizeRelativePath(path.relative(process.cwd(), rootDir) || "."),
          includePaths,
          totals: grouped.totals,
          filesByClassification: grouped.filesByClassification,
          findings,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  printTextReport({
    scannedFileCount: files.length,
    includePaths,
    totals: grouped.totals,
    filesByClassification: grouped.filesByClassification,
  });
}

function parseArgs(argv) {
  const options = {
    rootDir: "",
    includePaths: [],
    jsonOutput: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
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
    if (value === "--json") {
      options.jsonOutput = true;
    }
  }

  return options;
}

function summarize(findings) {
  const totals = {
    all: findings.length,
    replaceable: 0,
    protected: 0,
    outOfScope: 0,
  };
  const filesByClassification = {
    replaceable: new Map(),
    protected: new Map(),
    outOfScope: new Map(),
  };

  for (const finding of findings) {
    if (finding.classification === "replaceable") {
      totals.replaceable += 1;
      increment(filesByClassification.replaceable, finding.file);
      continue;
    }
    if (finding.classification === "protected") {
      totals.protected += 1;
      increment(filesByClassification.protected, finding.file);
      continue;
    }
    totals.outOfScope += 1;
    increment(filesByClassification.outOfScope, finding.file);
  }

  return {
    totals,
    filesByClassification: {
      replaceable: toSortedList(filesByClassification.replaceable),
      protected: toSortedList(filesByClassification.protected),
      outOfScope: toSortedList(filesByClassification.outOfScope),
    },
  };
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toSortedList(map) {
  return [...map.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file));
}

function printTextReport(payload) {
  process.stdout.write(
    `[brand:audit] scanned ${payload.scannedFileCount} file(s)\n` +
      `[brand:audit] include paths: ${payload.includePaths.join(", ")}\n` +
      `[brand:audit] matches: total=${payload.totals.all} ` +
      `replaceable=${payload.totals.replaceable} ` +
      `protected=${payload.totals.protected} ` +
      `out_of_scope=${payload.totals.outOfScope}\n`
  );

  printTop("replaceable", payload.filesByClassification.replaceable);
  printTop("protected", payload.filesByClassification.protected);
  printTop("out_of_scope", payload.filesByClassification.outOfScope);
}

function printTop(label, entries) {
  if (!entries.length) {
    process.stdout.write(`[brand:audit] ${label}: none\n`);
    return;
  }
  process.stdout.write(`[brand:audit] ${label} top files:\n`);
  for (const item of entries.slice(0, 10)) {
    process.stdout.write(`  - ${item.file}: ${item.count}\n`);
  }
}
