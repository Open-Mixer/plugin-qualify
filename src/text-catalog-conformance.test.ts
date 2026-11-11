// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * omx-contract#2 ("codes then catalogs"): every code of {@link TEXT_CODES} needs a `catalogs/ca.json` and a
 * `catalogs/es.json` entry, and every placeholder an entry uses must be one of that code's `args`. Red for a code
 * this package ships with no catalog entry in a shipped language, or a catalog entry naming a placeholder the code
 * does not declare.
 */
import { describe, expect, test } from "vitest";
import { catalogsDir, loadMessages, OWNER } from "./text-catalog.js";
import { TEXT_CODES } from "./text-codes.js";

const LANGS = ["ca", "es"] as const;

const placeholdersOf = (sentence: string): string[] => [...sentence.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? "");

describe("every shipped language has every code, with no placeholder the code does not declare", () => {
  for (const lang of LANGS) {
    test(lang, () => {
      const messages = loadMessages(lang, catalogsDir());
      expect(messages, `${OWNER}'s catalogs/${lang}.json does not read as a catalog`).toBeDefined();
      const problems: string[] = [];
      for (const c of Object.values(TEXT_CODES.codes)) {
        const sentence = messages?.[c.code];
        if (sentence === undefined) {
          problems.push(`${c.code}: no ${lang} entry`);
          continue;
        }
        for (const p of placeholdersOf(sentence)) {
          if (!c.args.includes(p)) problems.push(`${c.code}: ${lang} entry's {${p}} is not in its args (${c.args.join(", ") || "none"})`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
