// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The probe domain's words as this package judges with them: the outcome a probe's step or run ended with and the signal a
 * child died of. The domain is plugin-hostd-protocol's (contract.d/probe/probe.json, shipped by plugin-hostd-protocol-contract), data read at
 * run time; no word of it is a literal here. A word is asked for by its title, the key the domain gives it
 * (`probeCrashed`, `sigkill`), and the call refuses by name when the domain is not at hand or has no such word.
 *
 * Free of any Node module, so a page can use it: the page hands the document it serves to {@link initProbeDomain}. A Node
 * program reads the installed domain, through `probe-domain-node.ts`, at the first use.
 */

/** The domain's name, its directory and its file's stem. */
export const PROBE_DOMAIN = "probe";

/** The lowest `info.version` of the domain this package works with. */
export const PROBE_DOMAIN_FLOOR = "1.0.0";

/** What this package needs of an opened domain: the words of an item with their title, in the declared order. */
export interface ProbeWordSource {
  words(item: string): readonly { readonly word: string; readonly title: string }[];
}

/** A probe domain this package cannot use: absent, not valid, below the floor, or without the item or the word asked for. */
export class ProbeDomainError extends Error {
  constructor(place: string, reason: string) {
    super(`domain "${PROBE_DOMAIN}" at ${place}: ${reason}`);
    this.name = "ProbeDomainError";
  }
}

let handed: ProbeWordSource | undefined;
let installedReader: (() => ProbeWordSource) | undefined;

/** Hands the domain to this package (a page at start-up, a test, a CLI over another place); `undefined` forgets it. */
export function initProbeDomain(source: ProbeWordSource | undefined): void {
  handed = source;
}

/** Registers how a Node program reads the installed domain; only the Node module of the domain calls it. */
export function registerInstalledProbeReader(read: () => ProbeWordSource): void {
  installedReader = read;
}

/** The domain in use: the one handed to {@link initProbeDomain}, else the installed one, read at the first use and kept. */
export function probeDomain(): ProbeWordSource {
  if (handed !== undefined) return handed;
  if (installedReader === undefined) throw new ProbeDomainError("the page", "probe domain not handed: call initProbeDomain first");
  handed = installedReader();
  return handed;
}

function wordOf(item: string, title: string): string {
  const found = probeDomain().words(item).find((w) => w.title === title);
  if (found === undefined) throw new ProbeDomainError(item, `has no word titled ${title}`);
  return found.word;
}

/** The word of PROBE_OUTCOMES titled `title` (`probeOk`, `probeCrashed`, ...): how a step or a run ended. */
export const probeOutcome = (title: string): string => wordOf("PROBE_OUTCOMES", title);

/** The word of PROBE_SIGNALS titled `title` (`sigkill`, ...): the signal a child died of. */
export const probeSignal = (title: string): string => wordOf("PROBE_SIGNALS", title);
