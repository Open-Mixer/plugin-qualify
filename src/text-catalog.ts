// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sentence a surface shows for one of plugin-qualify's own {@link TextRef}s: the catalog's, for the given
 * language, else the source sentence `text-codes.ts` declares; its `{placeholder}`s filled from `args`
 * (`@openmixer/omx-contract/catalog`'s `sentenceOf` and `fill`, the one lookup every owner's surface makes).
 *
 * `catalogs/<lang>.json` ships inside this package (`package.json`'s `files`), read relative to this module so it
 * works from `src/` under vitest and from `dist/` once built alike. `PLUGIN_QUALIFY_CATALOGS_DIR` names another
 * directory instead, for a test that wants its own fixture catalogs.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fill, sentenceOf } from "@openmixer/omx-contract/catalog";
import { TEXT_CODES, type ReasonText, type TextRef } from "./text-codes.js";

export const OWNER = "plugin-qualify";
export const CATALOGS_DIR_ENV = "PLUGIN_QUALIFY_CATALOGS_DIR";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where this package's own `catalogs/<lang>.json` live: `PLUGIN_QUALIFY_CATALOGS_DIR`, else beside this module's package. */
export function catalogsDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env[CATALOGS_DIR_ENV] ?? join(PKG, "catalogs");
}

const SOURCE_BY_CODE: ReadonlyMap<string, string> = new Map(Object.values(TEXT_CODES.codes).map((c) => [c.code, c.text.en]));

const messagesCache = new Map<string, Record<string, string> | undefined>();

/** `catalogs/<lang>.json`'s `messages`, or `undefined` where the file is absent or does not read as one. */
export function loadMessages(lang: string, dir: string = catalogsDir()): Record<string, string> | undefined {
  const cacheKey = `${dir}\0${lang}`;
  if (messagesCache.has(cacheKey)) return messagesCache.get(cacheKey);
  let messages: Record<string, string> | undefined;
  try {
    const catalog = JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8")) as { messages?: Record<string, string> };
    messages = catalog.messages;
  } catch {
    messages = undefined;
  }
  messagesCache.set(cacheKey, messages);
  return messages;
}

/** The source sentence `code` was declared with (`text-codes.ts`); throws on a code this package never declared. */
export function sourceOf(code: string): string {
  const source = SOURCE_BY_CODE.get(code);
  if (source === undefined) throw new Error(`plugin-qualify declares no source sentence for ${code}`);
  return source;
}

/** `ref` rendered for `lang`: the catalog's sentence, else the source, its `{placeholder}`s filled. `lang` undefined or "en" skips the catalog. */
export function textOf(ref: TextRef, lang?: string): string {
  const source = sourceOf(ref.code);
  const sentence = lang === undefined || lang === "en" ? source : sentenceOf({ messages: loadMessages(lang) }, ref.code, source);
  return fill(sentence, ref.args ?? {});
}

/** A {@link ReasonText} rendered for `lang`: another tool's own words pass straight through; plugin-qualify's own go through {@link textOf}. */
export function reasonText(reason: ReasonText, lang?: string): string {
  return typeof reason === "string" ? reason : textOf(reason, lang);
}

/** The language of `LC_ALL`, else `LANG` (the POSIX precedence), as the two letters before `_` or `.`; `undefined` unset, unparsed, or `C`/`POSIX` (textOf's own fallback to the source sentence is the same as leaving this undefined). */
export function localeOf(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const raw = env["LC_ALL"] || env["LANG"];
  if (raw === undefined || raw === "") return undefined;
  const m = /^([a-z]{2})(?:[_.].*)?$/.exec(raw);
  return m?.[1];
}
