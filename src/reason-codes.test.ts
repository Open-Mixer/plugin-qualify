// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * plugin-qualify#42: the reasons and errors still written as English inline become codes of `schema/codes.json`, with
 * their arguments, so every language's catalog says them (text-catalog-conformance holds each code to its catalogs).
 * The places the issue names: the judged layer's reasons, the records package's `why` lines, the plugin-hostd search
 * path's errors and warnings, two lines of the sync, the scanner's refusals, and the CLI usage errors. A sentence
 * another tool wrote (a prober's or the OS's words) passes through as it is: it is an argument, never a literal here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(PKG, p), "utf8");

/** The lines of `file` matching `pattern`, numbered, comments left out. */
function hits(file: string, pattern: RegExp): string[] {
  return read(file)
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*\*|#)/.test(line) && pattern.test(line))
    .map(({ line, n }) => `${file}:${String(n)}: ${line.trim()}`);
}

const LITERAL = String.raw`[\`"]`;

describe("plugin-qualify#42: no reason or error of its own is English inline", () => {
  test("the judged layer's reasons are codes", () => {
    expect(hits("src/judged-layer.ts", new RegExp(`reason: ${LITERAL}`))).toEqual([]);
  });

  test("the records package says why a record is left out with a code", () => {
    expect(hits("src/records-package.ts", new RegExp(`why: ${LITERAL}`))).toEqual([]);
  });

  test("the plugin-hostd search path's errors and warnings are codes", () => {
    expect(hits("src/hostd-search-path.ts", new RegExp(`error: ${LITERAL}|\\? ${LITERAL}this plugin-hostd|=> \`\\$\\{k\\} is plugin-hostd`))).toEqual([]);
  });

  test("the sync's own two lines are codes", () => {
    expect(hits("src/qualify-sync.ts", /"no plugin was listed"|"the measurement wrote no document"/)).toEqual([]);
  });

  test("the scanner's refusals say their problem with a code", () => {
    expect(hits("tools/descriptors.py", /DescriptorRefused\(DESCRIPTOR_CODE_\w+,\s*f?"/)).toEqual([]);
  });

  test("a CLI usage error is a code", () => {
    const CLI = [
      "src/adjust-cli.ts",
      "src/compare.ts",
      "src/here.ts",
      "src/judge-cli.ts",
      "src/judged-layer.ts",
      "src/measurement-grid.ts",
      "src/memory-bound.ts",
      "src/qualify-adapter-pass.ts",
      "src/qualify-cli.ts",
      "src/records-package.ts",
    ];
    expect(CLI.flatMap((f) => hits(f, new RegExp(`ok: false, error: ${LITERAL}`)))).toEqual([]);
  });
});
