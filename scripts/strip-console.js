#!/usr/bin/env node
/**
 * strip-console.js
 * Removes console.log / console.debug / console.info calls from JS files.
 * Preserves console.error and console.warn.
 * Idempotent: running multiple times produces the same result.
 *
 * Usage: node scripts/strip-console.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const TARGET_DIR = path.resolve(__dirname, "../frontend/assets/js");
const DRY_RUN = process.argv.includes("--dry-run");

// Matches: console.log(...) / console.debug(...) / console.info(...)
// Handles multi-line calls by tracking balanced parentheses.
// Also handles optional leading whitespace and trailing semicolon.
const STRIPPED_METHODS = new Set(["log", "debug", "info"]);

/**
 * Strip targeted console calls from source text.
 * Returns { output, count } where count is number of calls removed.
 */
function stripConsoleCalls(source) {
  let output = "";
  let i = 0;
  let count = 0;
  const len = source.length;

  while (i < len) {
    // Look for `console.` followed by log|debug|info
    const consoleIdx = source.indexOf("console.", i);
    if (consoleIdx === -1) {
      // No more console calls — append rest and stop
      output += source.slice(i);
      break;
    }

    // Check which method follows `console.`
    const afterDot = consoleIdx + "console.".length;
    let method = null;
    for (const m of STRIPPED_METHODS) {
      if (source.startsWith(m, afterDot)) {
        const charAfter = source[afterDot + m.length];
        if (charAfter === "(" || charAfter === " " || charAfter === "\t") {
          method = m;
          break;
        }
      }
    }

    if (!method) {
      // Not a targeted method — emit up to and including `console.` and move on
      output += source.slice(i, afterDot);
      i = afterDot;
      continue;
    }

    // Find the opening paren
    const parenStart = source.indexOf("(", afterDot + method.length);
    if (parenStart === -1) {
      output += source.slice(i, afterDot);
      i = afterDot;
      continue;
    }

    // Find matching closing paren, respecting strings and nesting
    let depth = 1;
    let j = parenStart + 1;
    let inStr = null; // null | "'" | '"' | "`"
    while (j < len && depth > 0) {
      const ch = source[j];
      if (inStr) {
        if (ch === "\\" ) {
          j += 2; // skip escaped char
          continue;
        }
        if (ch === inStr) inStr = null;
      } else {
        if (ch === '"' || ch === "'" || ch === "`") {
          inStr = ch;
        } else if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
        }
      }
      j++;
    }

    // j now points one past the closing paren
    // Optionally consume trailing semicolon
    let end = j;
    if (source[end] === ";") end++;

    // Determine the line that contains this console call.
    // Find start of line by scanning backwards from consoleIdx.
    let lineStart = consoleIdx;
    while (lineStart > 0 && source[lineStart - 1] !== "\n") lineStart--;

    const linePrefix = source.slice(lineStart, consoleIdx);
    const onlyWhitespaceBefore = /^\s*$/.test(linePrefix);

    if (onlyWhitespaceBefore) {
      // Remove the entire line (including leading whitespace and trailing newline)
      // Append everything from i up to (but not including) lineStart
      output += source.slice(i, lineStart);
      // Skip to end of call, then skip the trailing newline if present
      if (source[end] === "\n") end++;
      i = end;
    } else {
      // Inline call (e.g., inside an if condition) — remove just the call expression
      output += source.slice(i, consoleIdx);
      i = end;
    }

    count++;
  }

  return { output, count };
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  const files = walkDir(TARGET_DIR);
  let totalBefore = 0;
  let totalRemoved = 0;
  let filesModified = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");

    // Count original occurrences for reporting
    const originalMatches = (source.match(/console\.(log|debug|info)\s*\(/g) || []).length;
    totalBefore += originalMatches;

    const { output, count } = stripConsoleCalls(source);
    totalRemoved += count;

    if (count > 0) {
      filesModified++;
      const rel = path.relative(path.resolve(__dirname, ".."), filePath);
      if (!DRY_RUN) {
        fs.writeFileSync(filePath, output, "utf8");
      }
      console.warn(`  [${DRY_RUN ? "dry" : "mod"}] ${rel}: removed ${count} call(s)`);
    }
  }

  console.warn(`\nSummary:`);
  console.warn(`  Files scanned : ${files.length}`);
  console.warn(`  Files modified: ${filesModified}`);
  console.warn(`  Calls before  : ${totalBefore}`);
  console.warn(`  Calls removed : ${totalRemoved}`);
  if (DRY_RUN) console.warn(`  (dry-run — no files written)`);
}

main();
