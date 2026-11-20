// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sync's store pass (#73): every plugin a run recorded with a whole pin is written to plugin-db's store, the
 * pinned layer first (`plugin-db pin`), then the judged layer plugin-qualify is the one writer of (`plugin-db put
 * <address> judged --writer plugin-qualify`), so a reader's `plugin-db query` answers for it. plugin-db hashes the
 * plugin's files itself, from where the pin's uri says they are; the layout is the pin's, the body the record's
 * (`judged-layer.ts`). Nothing here measures or judges.
 */
import { keyLabel, type QualificationStore } from "./qualification-store.js";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

import { judgedLayerOf } from "./judged-layer.js";
import { SPAWNED_PLUGIN_DB, pluginDbPin, pluginDbPutJudged, type PinWhere, type PluginDbRun } from "./plugin-db-cli.js";
import { layerPinOf } from "./plugin-db-pin.js";
import { VERSION } from "./judgement-line.js";
import type { QualificationRecord } from "./qualification-record.js";
import type { SyncState } from "./qualify-sync.js";

export interface StoreOptions {
  /** The machine class word of this device (`host_class`); none, and nothing is stored. */
  readonly machineClass: string | undefined;
  /** The service's store (`--system`), else plugin-db's own default. */
  readonly system: boolean;
  /** The LV2 directories the sync scanned, as one search path: plugin-db finds an LV2 plugin's bundle in it. */
  readonly lv2Path: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The qualification store the records are read from. */
  readonly records: QualificationStore;
  readonly run?: PluginDbRun;
  /**
   * What was written, by address, so an unchanged plugin is not written again (plugin-db hashes every file of a pin, a
   * minute and more for a device's plugins). Deleting it writes every plugin again; none, and every plugin is written.
   */
  readonly stampFile?: string;
}

export const STORE_STAMP_SCHEMA = "plugin-qualify.store-stamp/1";

function readStamp(path: string | undefined): Map<string, string> {
  if (path === undefined) return new Map();
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as { schema?: unknown; entries?: unknown };
    if (s.schema !== STORE_STAMP_SCHEMA || typeof s.entries !== "object" || s.entries === null) return new Map();
    return new Map(Object.entries(s.entries as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return new Map();
  }
}

function writeStamp(path: string, stamps: Map<string, string>): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ schema: STORE_STAMP_SCHEMA, entries: Object.fromEntries([...stamps].sort()) }, null, 1)}\n`);
  renameSync(tmp, path);
}

export interface StoreOutcome {
  readonly stored: number;
  /** Written by an earlier run as they are now: not written again. */
  readonly already: number;
  readonly noPin: number;
  readonly noLayer: number;
  readonly refused: number;
  /** What the pass says: one line per kind of problem, with the first plugin it met, then the counts. */
  readonly lines: readonly string[];
}

/** The plugin-qualify that judged a record that states no rules: its distributed set's, else this one. */
function judgedByOf(record: QualificationRecord): string {
  const packages = (record.provenance as { packages?: Record<string, unknown> } | undefined)?.packages;
  const v = packages?.["plugin-qualify"];
  return typeof v === "string" && v !== "" ? v : VERSION;
}

/** Where plugin-db finds the plugin: the .clap file of a `clap:<path>#<id>` uri, else the LV2 search path. */
function whereOf(uri: string, lv2Path: string): PinWhere {
  const m = /^clap:(.+?)(#.*)?$/.exec(uri);
  return m ? { file: m[1]! } : { lv2Path };
}

function grouped(kind: string, byReason: Map<string, { n: number; first: string }>): string[] {
  return [...byReason].map(([reason, g]) => `plugin-db: ${String(g.n)} ${g.n === 1 ? "record" : "records"} ${kind}: ${reason} (the first: ${g.first})`);
}

function add(byReason: Map<string, { n: number; first: string }>, reason: string, path: string): void {
  const g = byReason.get(reason);
  if (g === undefined) byReason.set(reason, { n: 1, first: path });
  else g.n++;
}

/** Writes the pin and the judged layer of every recorded, pinned plugin of a sync state into plugin-db's store. */
export function storeJudgedLayers(state: SyncState, opts: StoreOptions): StoreOutcome {
  const none = { stored: 0, already: 0, noPin: 0, noLayer: 0, refused: 0 };
  if (opts.machineClass === undefined) return { ...none, lines: ["plugin-db: this machine's class is not known (host_class), so no plugin was stored"] };
  const base = opts.run ?? SPAWNED_PLUGIN_DB;
  let missing = false;
  const run: PluginDbRun = (args, input, env) => {
    const r = base(args, input, env);
    if (r.missing === true) missing = true;
    return r;
  };
  const call = { system: opts.system };
  let { stored, already, noPin, noLayer, refused } = none;
  const stamps = readStamp(opts.stampFile);
  const layerless = new Map<string, { n: number; first: string }>();
  const refusals = new Map<string, { n: number; first: string }>();
  for (const entry of Object.values(state.entries)) {
    for (const p of entry.plugins) {
      if (p.record === undefined) continue;
      const pin = p.pin === undefined ? undefined : layerPinOf(p.pin.integrity);
      if (pin === undefined) {
        noPin++;
        continue;
      }
      const record = opts.records.record(p.record);
      if (record === undefined) {
        noLayer++;
        add(layerless, "the record is not in the qualification store", keyLabel(p.record));
        continue;
      }
      const layer = judgedLayerOf(record, { machineClass: opts.machineClass, pin, judgedBy: judgedByOf(record) });
      if (layer.layer === null) {
        noLayer++;
        add(layerless, layer.reason, keyLabel(p.record));
        continue;
      }
      const where = whereOf(p.pin!.uri, opts.lv2Path);
      const key = createHash("sha256").update(JSON.stringify([opts.system, where, pin, layer.body])).digest("hex");
      if (stamps.get(layer.address) === key) {
        already++;
        continue;
      }
      const pinned = pluginDbPin(layer.address, where, pin.layout, call, opts.env, run);
      if (missing) return { ...none, lines: ["plugin-db is not installed: the store is plugin-db's to pin; no plugin was stored"] };
      const put = pinned.ok ? pluginDbPutJudged(layer.address, layer.body, call, opts.env, run) : pinned;
      if (put.ok) {
        stored++;
        stamps.set(layer.address, key);
      } else {
        stamps.delete(layer.address);
        refused++;
        add(refusals, put.detail, layer.address);
      }
    }
  }
  if (opts.stampFile !== undefined) writeStamp(opts.stampFile, stamps);
  const lines = [
    ...grouped("with no judged layer", layerless),
    ...grouped("refused by plugin-db", refusals),
    `plugin-db: ${String(stored)} plugins stored in the ${opts.system ? "system " : ""}store, ${String(already)} already there, ${String(noPin)} without a pin, ${String(noLayer)} without a judged layer, ${String(refused)} refused`,
  ];
  return { stored, already, noPin, noLayer, refused, lines };
}
