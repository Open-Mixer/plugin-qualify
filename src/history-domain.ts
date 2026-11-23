// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The words of the running-history keys as this package reads them: plugin-hostd's `plugin-hostd/history` domain
 * (contract.d/plugin-hostd/history/history.json, shipped by plugin-hostd-contract), item PLUGIN_HOSTD_HISTORY_KEYS, the key a
 * record line spells (`windows_solo=400`).
 * The domain gives each word a title (`windowsSolo`); this package keeps, per title, the field the value fills and how it is
 * written, which are the parser's own. A key is asked for by its title, and the call refuses by name when the domain is not at
 * hand or has no such word.
 *
 * Free of any Node module: a Node program reads the installed domain, through `history-domain-node.ts`, at the first use.
 */

/** The domain's name and its directory; its file's stem is the last segment (`history`). */
export const HISTORY_DOMAIN = "plugin-hostd/history";

/** The item the keys are the words of. */
export const HISTORY_KEYS_ITEM = "PLUGIN_HOSTD_HISTORY_KEYS";

/** The lowest `info.version` of the domain this package works with. */
export const HISTORY_DOMAIN_FLOOR = "1.0.0";

/** What this package needs of an opened domain: the words of an item with their title, in the declared order. */
export interface HistoryWordSource {
  words(item: string): readonly { readonly word: string; readonly title: string }[];
}

/** A history domain this package cannot use: absent, not valid, below the floor, or without the item or the word asked for. */
export class HistoryDomainError extends Error {
  constructor(place: string, reason: string) {
    super(`domain "${HISTORY_DOMAIN}" at ${place}: ${reason}`);
    this.name = "HistoryDomainError";
  }
}

let handed: HistoryWordSource | undefined;
let installedReader: (() => HistoryWordSource) | undefined;

/** Hands the domain to this package (a test, a CLI over another place); `undefined` forgets it. */
export function initHistoryDomain(source: HistoryWordSource | undefined): void {
  handed = source;
}

/** Registers how a Node program reads the installed domain; only the Node module of the domain calls it. */
export function registerInstalledHistoryReader(read: () => HistoryWordSource): void {
  installedReader = read;
}

/** The domain in use: the one handed to {@link initHistoryDomain}, else the installed one, read at the first use and kept. */
export function historyDomain(): HistoryWordSource {
  if (handed !== undefined) return handed;
  if (installedReader === undefined) throw new HistoryDomainError("the page", "history domain not handed: call initHistoryDomain first");
  handed = installedReader();
  return handed;
}

/** The words of PLUGIN_HOSTD_HISTORY_KEYS in the domain's order, each with its title. */
export function historyKeys(): readonly { readonly word: string; readonly title: string }[] {
  return historyDomain().words(HISTORY_KEYS_ITEM);
}
