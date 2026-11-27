// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The pin: the key plus an exact match of the per-file SHA-256 set (the store spec's section 3.7). An installed item
 * matches a stored record when the files it holds are exactly the record's list: the same paths below the install root
 * and, hashed here, the same SHA-256 for each, none missing and none beside them. Where the item is installed, the
 * record's name, its set and its host class decide nothing, and no probe column is read: the pin has no probe bytes.
 */
import { join } from "node:path";

import { cellKey, type GridCell } from "./measurement-grid.js";
import { clapPinUri, pinVerdictOf, type PinEntry } from "./pins-file.js";
import type { ShadowKey, StoredResult } from "./qualification-store.js";
import { outcomeOfVerdict } from "./distributed-records.js";
import type { SyncItem } from "./qualify-sync.js";
import type { SuitabilityRating } from "./rating.js";

export type StoredMatch =
  /** No record names the plugin: it is measured, and nothing is said. */
  | { readonly status: "none" }
  /** Every reason a record found was not taken, one line each; the plugin is measured. `why` is the first reason that
   * left none: no record of these bytes, none at the cells the sync runs at, none judged for this host, or one the
   * source itself left unmeasured (the re-qualify queue's reason, #204). */
  | { readonly status: "ignored"; readonly lines: readonly string[]; readonly why: "bytes" | "cell" | "host" | "source-unmeasured" }
  /** The plugin's keys of these bytes, in the order the reader gave them (the user layer first). Which record of a key is
   * taken is the store's claim at the machine's cell (`QualificationStore.recordAt`), not this order (#152). */
  | { readonly status: "applies"; readonly keys: readonly ShadowKey[]; readonly lines: readonly string[] };

const keyOf = (r: StoredResult): ShadowKey => ({ sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, hostClass: r.host_class });
const idOf = (r: StoredResult): string => [r.layer, r.sha256, r.uri, r.offer, r.host_class].join("\0");

/** The uri a record's plugin has on this machine: the installed `.clap`'s path and the id, or the LV2 uri. */
export const storedUri = (item: SyncItem, r: Pick<StoredResult, "uri" | "format">): string => (item.format === "clap" ? clapPinUri(join(item.root, item.files[0]!), `urn:clap:${r.uri}`) : r.uri);

/**
 * Whether the item is taken from the records the reader gave for it. A record counts only when the files plugin-hostd
 * names for the item's pin (`--pin-files`, as `withHostdFiles` takes them; not the sync's own discovery) are exactly its list; the cells of the sync must all be held; the host must have a verdict, and one the source could
 * measure. The keys of the same bytes apply; each key's cells are the ones the store's claim gives it.
 */
export function matchStored(
  results: readonly StoredResult[],
  item: SyncItem,
  host: string,
  pinFiles: readonly { readonly path: string; readonly sha256: string }[] | undefined,
  cells: readonly GridCell[] = [],
): StoredMatch {
  const found = results.filter((r) => r.format === item.format);
  if (found.length === 0) return { status: "none" };
  const lines: string[] = [];
  const say = (line: string): void => {
    if (!lines.includes(line)) lines.push(line);
  };
  const records = new Map<string, StoredResult[]>();
  for (const r of found) records.set(idOf(r), [...(records.get(idOf(r)) ?? []), r]);
  const mine = new Map<string, StoredResult[]>();
  const now = pinFiles;
  for (const [id, cellsOf] of records) {
    const r = cellsOf[0]!;
    const named = item.format === "clap" ? r.binary_path === item.files[0] : true;
    const same = now !== undefined && named && r.files.length === now.length && r.files.every((f) => now.find((d) => d.path === f.path)?.sha256 === f.sha256);
    if (!same) {
      if (now === undefined) say(`stored: ${storedUri(item, r)}: plugin-hostd named no files for it`);
      say(`stored: ${storedUri(item, r)}: binary differs`);
      continue;
    }
    mine.set(id, cellsOf);
  }
  if (mine.size === 0) return { status: "ignored", lines, why: "bytes" };
  const atCell = [...mine.values()].filter((cellsOf) => {
    const held = new Set(cellsOf.map((c) => cellKey(c)));
    if (cells.every((c) => held.has(cellKey(c)))) return true;
    say(`stored: ${storedUri(item, cellsOf[0]!)}: measured at ${[...held].join(", ")}`);
    return false;
  });
  const judged = atCell.filter((cellsOf) => cellsOf[0]!.verdicts.some((v) => v.host === host));
  if (atCell.length > 0 && judged.length === 0) say(`stored: ${storedUri(item, atCell[0]![0]!)}: no verdict for ${host}`);
  const unmeasured = judged.find((cellsOf) => {
    const v = cellsOf[0]!.verdicts.find((x) => x.host === host)!;
    return outcomeOfVerdict({ measured: v.measured === 1, rating: v.rating, ...(v.deciding === null ? {} : { deciding: v.deciding }) }) === "unmeasured";
  });
  if (unmeasured !== undefined) {
    say(`stored: ${storedUri(item, unmeasured[0]!)}: unmeasured at the source, measured here`);
    return { status: "ignored", lines, why: "source-unmeasured" };
  }
  if (judged.length === 0) return { status: "ignored", lines, why: atCell.length === 0 ? "cell" : "host" };
  return { status: "applies", keys: atCell.map((c) => keyOf(c[0]!)), lines };
}

/**
 * The pin a match gives plugin-hostd, built from the record's list, layout and tested version (section 3.7); none for a
 * record that is unpinnable or holds no layout: the plugin is pinned on its first add, as when no pin was taken.
 */
export function pinOfStored(item: SyncItem, r: StoredResult, host: string, reasons?: Parameters<typeof pinVerdictOf>[1]): PinEntry | undefined {
  if (r.unpinnable === 1 || r.layout_scheme === null || r.layout_sha256 === null) return undefined;
  const v = r.verdicts.find((x) => x.host === host);
  const word = v !== undefined && v.measured === 1 ? pinVerdictOf(v.rating as SuitabilityRating, reasons) : undefined;
  return {
    uri: storedUri(item, r),
    integrity: {
      ...(r.tested_version === null ? {} : { version: r.tested_version }),
      files: r.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      layout: { scheme: r.layout_scheme, sha256: r.layout_sha256 },
    },
    ...(word === undefined ? {} : { verdict: word }),
  };
}
