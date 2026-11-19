// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Keeping a device's qualification records through an upgrade, instead of measuring every plugin again. An upgrade is a
 * different host (`HOSTING_NOTE`): the figures are carried across and judged again, never trusted.
 *
 * `plugin-qualify-sync --rejudge` measures nothing. Each record of the scope's user layer, as the store exports it, goes
 * through the one judge (`judgeProbeOutput`) from its rows alone (`row-judge.ts`; no probe bytes are kept) under today's rules, with the host runs the record already holds, and the verdicts, the tiers and
 * the plugin's pin word are replaced; the figures and their provenance are not touched, and the record says who took the
 * figures and when. A verdict that needs a run the record lacks (an LV2 plugin's omx-clap-host verdict is decided by its
 * adapter run) reads `unknown`, and the record owes that run: nothing is guessed, and a run that never happened gives a
 * plugin no pin word. A record whose plugin's bytes changed, or whose rows lack a figure the judge needs, is left as it
 * is and owes a qualification. A second run changes nothing.
 *
 * `plugin-qualify-sync --memory-only` takes one figure: the footprint of each recorded plugin at the cells a Pi runs,
 * through the probe runner, under the limits of an ordinary run, in a world of its bundle only. Only the `memory` of those
 * cells changes in the record. It judges nothing: a `--rejudge` afterwards reads the footprints. Growth over time needs a
 * soak, which this does not run: the record says so in `notMeasured`.
 */
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { outcomeOfVerdict } from "./distributed-records.js";
import { ADAPTER_RUN_HOSTS, ADMITTED_HOSTS, type HostAdmission } from "./host-admission.js";
import { OMX_CLAP_HOST_CONFIGURED_EXTENSIONS, shippedHostProfile, type HostProfile } from "./host-profiles.js";
import { HOSTING_CODE } from "./hosting-codes.js";
import { readMemoryFootprint } from "./measurement/format.js";
import type { PluginTarget } from "./loader.js";
import { cellKey, type GridCell } from "./measurement-grid.js";
import { pinVerdictOf } from "./pins-file.js";
import { failedOutcome, judgeProbeOutput, type RecordReason } from "./probe-judge.js";
import { PROBE_OK, type ProbeGridPoint, type ProbeOutput } from "./probe-output.js";
import { probeTarget, ProbeRunnerError, type ProbeRun } from "./probe-runner.js";
import { proberOffer } from "./clap-qualify.js";
import {
  IN_PROCESS_TIER_HOST,
  ISOLATED_TIER_HOST,
  QUALIFICATION_RECORD_SCHEMA,
  memoryOfCell,
  tiersOf,
  unmeasuredWordOf,
  verdictRows,
  type NotMeasured,
  type OwedMeasurement,
  type QualificationRecord,
  type RecordGridPoint,
  type RecordVerdict,
  type RunBlock,
} from "./qualification-record.js";
import { ISOLATED_RESULT, RUN_STEP, isolatedFinished, pinAfterStep } from "./qualify-isolated.js";
import { pinAfterPool, poolStepOf } from "./qualify-pool.js";
import { PI_CELLS, PROBE_MEMORY_ONLY_ENV, PROBE_NOTES_ENV } from "./qualify-declarations.js";
import { SYNC_STATE_SCHEMA, digestFiles, type SyncContext, type SyncEntry, type SyncPlugin, type SyncState } from "./qualify-sync.js";
import { keyId, keyLabel, shadowKeyOf, type ShadowKey, type StoredRecord } from "./qualification-store.js";
import { outputOfRows, rowsUnreadable } from "./row-judge.js";
import { writeFileWhole } from "./whole-file.js";
import type { SuitabilityRating } from "./rating.js";

/** The codes of a measurement a record owes. */
export const OWED_CODE = {
  isolatedStep: "qualify.sync.isolated-step-owed",
  /** An LV2 verdict of a host that runs it through the adapter, and no measured adapter run. */
  adapterRun: "qualify.sync.adapter-run-owed",
  /** A verdict decided by a run under its host (mod-host, jalv), and no run in the record. */
  hostRun: "qualify.sync.host-run-owed",
  /** The plugin's files are not the bytes the record measured. */
  bytesChanged: "qualify.sync.bytes-changed",
  /** The probe output is missing, is not the copy the record names, or does not read. */
  figuresUnreadable: "qualify.sync.figures-unreadable",
  /** The plugin has a record that holds no figures at all. */
  noFigures: "qualify.sync.no-figures",
} as const;

/** The cells the memory-only pass measures: the ones a Pi runs, 48 kHz at 128 and 256 frames. */
export const MEMORY_PASS_CELLS: readonly GridCell[] = PI_CELLS;

/** What a memory-only pass cannot say, in every record it writes to: growth over time needs a soak. */
export const MEMORY_PASS_NOT_MEASURED: NotMeasured = { dimension: "memoryGrowth", code: HOSTING_CODE.stabilityUnsoaked };

/** The tool as the record says it: this package's own version, read where it is installed. */
export function rejudgeToolName(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return `plugin-qualify ${pkg.version ?? "unknown"}`;
  } catch {
    return "plugin-qualify unknown";
  }
}

/** A world holding one bundle, as plugin-hostd runs a pinned LV2 plugin, for as long as `body` runs. */
export function lv2World<T>(bundle: string, body: (world: string) => T): T {
  const world = mkdtempSync(join(tmpdir(), "plugin-qualify-sync-world-"));
  try {
    symlinkSync(bundle, join(world, basename(bundle)));
    return body(world);
  } finally {
    rmSync(world, { recursive: true, force: true });
  }
}

// --- the judgment of one record ---------------------------------------------------------------------------------------

/** The probe output with the footprints a memory-only pass merged into the record: the probe copy itself stays as it was taken. */
function withMemoryRun(output: ProbeOutput, record: QualificationRecord): ProbeOutput {
  const merged = record.memoryRun;
  if (merged === undefined) return output;
  const grid: ProbeGridPoint[] = [...output.grid];
  for (const c of merged.cells) {
    const point = record.measurements.grid.find((p) => p.rate === c.rate && p.quantum === c.quantum);
    const memory = readMemoryFootprint(point?.memory);
    if (memory === undefined) continue;
    const at = grid.findIndex((p) => p.rate === c.rate && p.quantum === c.quantum);
    if (at >= 0) grid[at] = { ...grid[at]!, memory };
    else grid.push({ rate: c.rate, quantum: c.quantum, outcome: PROBE_OK, memory });
  }
  return { ...output, grid };
}

/** The offer a profile is judged under for a CLAP plugin; `undefined` for a host the prober cannot stand in for. */
const offerIdOf = (profile: HostProfile): string | undefined => {
  const offer = proberOffer(profile);
  return offer === undefined ? undefined : offer.length > 0 ? "custom" : "default";
};

/**
 * The profiles a record is judged under: the hosts it has verdicts for, the console's two tiers, the host of this run, and
 * the Pi boards, whose budgets read the footprints. A host only joins a CLAP plugin's record of its own offer.
 */
function rejudgeProfiles(record: QualificationRecord, output: ProbeOutput, host: string): { profiles: HostProfile[]; kept: RecordVerdict[] } {
  const format = output.plugin.format;
  const added = [IN_PROCESS_TIER_HOST, ISOLATED_TIER_HOST[format], host, ...ADAPTER_RUN_HOSTS].filter((id): id is string => id !== undefined);
  const profiles = new Map<string, HostProfile>();
  const kept: RecordVerdict[] = [];
  for (const v of record.verdicts) {
    const p = shippedHostProfile(v.host);
    if (p === undefined) kept.push(v);
    else profiles.set(p.id, p);
  }
  for (const id of added) {
    const p = shippedHostProfile(id);
    if (p === undefined || profiles.has(id)) continue;
    if (format === "lv2" || offerIdOf(p) === output.offer.id) profiles.set(id, p);
  }
  return { profiles: [...profiles.values()], kept };
}

/** The runs the record holds, as the judge takes them: its adapter run, and each `run` verdict of a host that is decided by one. */
function admissionsOf(record: QualificationRecord): Record<string, HostAdmission> {
  const out: Record<string, HostAdmission> = {};
  for (const v of record.verdicts) {
    const host = ADMITTED_HOSTS.find((h) => h === v.host);
    if (host === undefined || v.arm !== "run") continue;
    const r = v.reasons.find((x) => x.dimension === "hostAdmission");
    out[host] = r === undefined ? { host, measured: true, admitted: true, params: {} } : { host, measured: r.rating !== "unknown", admitted: false, code: r.code, params: r.params };
  }
  const a = record.adapter;
  if (a?.measured === true) {
    const run: HostAdmission = { host: "omx-clap-host", measured: true, admitted: a.admitted, ...(a.code === undefined ? {} : { code: a.code }), params: a.params };
    for (const id of ADAPTER_RUN_HOSTS) out[id] = run;
  }
  return out;
}

const owedReason = (code: string, params: RecordReason["params"]): RecordReason => ({ dimension: "hostAdmission", rating: "unknown", code, params });

/** The runs the verdicts of these profiles need and the record does not hold. A run that did not end well decides nothing, so it owes none. */
function runsOwed(record: QualificationRecord, output: ProbeOutput, profiles: readonly HostProfile[]): { reasons: Record<string, RecordReason>; owes: OwedMeasurement[] } {
  const reasons: Record<string, RecordReason> = {};
  const owes: OwedMeasurement[] = [];
  if (failedOutcome(output) !== undefined) return { reasons, owes };
  if (output.plugin.format === "lv2" && record.adapter?.measured !== true) {
    const why = record.adapter?.code;
    const params: RecordReason["params"] = why === undefined ? {} : { lastRun: why };
    for (const p of profiles) if (ADAPTER_RUN_HOSTS.includes(p.id)) reasons[p.id] = owedReason(OWED_CODE.adapterRun, params);
    owes.push({ measurement: "adapter-run", host: "omx-clap-host", code: OWED_CODE.adapterRun, ...(why === undefined ? {} : { detail: why }) });
  }
  for (const v of record.verdicts) {
    if (!ADMITTED_HOSTS.some((h) => h === v.host) || v.arm === "run") continue;
    reasons[v.host] = owedReason(OWED_CODE.hostRun, { host: v.host });
    owes.push({ measurement: "host-run", host: v.host, code: OWED_CODE.hostRun });
  }
  return { reasons, owes };
}

export class RejudgeRefusal extends Error {}

/**
 * One record judged again from the probe output the judge is handed: the one the rows build (`rejudgeFromRows`), or the
 * probe's own, which is the oracle of the store spec's case C6b. The figures, who took them and when are as they were;
 * only the verdicts, the tiers and the cost reasons beside them are new. `at` is the prior re-judge's when nothing else
 * differs, so that a second run leaves the record alone.
 */
export function rejudgeWithOutput(record: QualificationRecord, probe: ProbeOutput, options: { readonly host: string; readonly by: string; readonly at: string }): { record: QualificationRecord; owes: readonly OwedMeasurement[] } {
  const output = withMemoryRun(probe, record);
  const { profiles, kept } = rejudgeProfiles(record, output, options.host);
  const { reasons, owes: runs } = runsOwed(record, output, profiles);
  const judgment = judgeProbeOutput(output, profiles, { admissions: admissionsOf(record), owed: reasons });
  // decides no verdict: a record from before the steps that reads isolated stays offered and runs alone, and owes the step until one has finished; a refusal is finished: it is the step's verdict, not debt
  const readsIsolated = judgment.hosts.some((h) => h.verdict.measured && h.verdict.rating === "conditional");
  const owes = readsIsolated && !isolatedFinished(record) ? [...runs, { measurement: "isolated-step" as const, code: OWED_CODE.isolatedStep }] : runs;
  const memory = record.memoryRun === undefined ? {} : { memory: { tool: record.memoryRun.tool, measuredAt: record.memoryRun.measuredAt } };
  const a = record.adapter;
  const adapterTaken = a?.versions === undefined || a.measuredAt === undefined ? {} : { adapter: { versions: a.versions, measuredAt: a.measuredAt } };
  const { rejudged: prior, ...rest } = record;
  const next = (at: string): QualificationRecord => ({
    ...rest,
    verdicts: [...verdictRows(judgment), ...kept],
    tiers: tiersOf(judgment),
    cost: judgment.hosts.map((h) => ({ host: h.verdict.host, ...h.cost })),
    rejudged: {
      at,
      by: options.by,
      figures: { tool: record.tool, measuredAt: record.measuredAt, runId: probe.run.id, ...memory, ...adapterTaken },
      ...(owes.length === 0 ? {} : { owes }),
    },
  });
  const same = prior !== undefined && JSON.stringify(next(prior.at)) === JSON.stringify(record);
  return { record: same ? record : next(options.at), owes };
}

/** One record of the store judged again from its rows alone; a record whose rows lack a figure the judge needs throws, naming it. */
export function rejudgeFromRows(stored: StoredRecord, options: { readonly host: string; readonly by: string; readonly at: string }): { record: QualificationRecord; owes: readonly OwedMeasurement[] } {
  const why = rowsUnreadable(stored);
  if (why !== undefined) throw new RejudgeRefusal(why);
  return rejudgeWithOutput(stored.record, outputOfRows(stored), options);
}

// --- a device's records -----------------------------------------------------------------------------------------------

/** The file that lists what a re-judge left owing, beside the state file. */
export const owedFile = (stateFile: string): string => join(dirname(stateFile), "qualify-owed.json");

export const OWED_SCHEMA = "plugin-qualify.owed/1";

export interface OwingRecord {
  readonly plugin: string;
  /** The record's file name, when the plugin has one. */
  readonly record?: string;
  readonly owes: readonly OwedMeasurement[];
}

export interface RejudgeResult {
  readonly state: SyncState;
  readonly changed: number;
  readonly unchanged: number;
  readonly owing: readonly OwingRecord[];
}

/** The entries whose files are not the bytes they were qualified from, and the keys of their records. */
function changedKeys(state: SyncState): { keys: Set<string>; entries: Set<string> } {
  const keys = new Set<string>();
  const entries = new Set<string>();
  for (const [key, e] of Object.entries(state.entries)) {
    const now = digestFiles(e.root, e.files.map((f) => f.path), e.files);
    if (now !== undefined && now.every((f) => e.files.some((x) => x.path === f.path && x.sha256 === f.sha256))) continue;
    entries.add(key);
    for (const p of e.plugins) if (p.record !== undefined) keys.add(keyId(p.record));
  }
  return { keys, entries };
}

/** A state plugin with the verdict its record now holds for the host: the pin's files stay as they are, only its word follows. */
function pluginWithVerdict(plugin: SyncPlugin, v: RecordVerdict, run?: RunBlock): SyncPlugin {
  // the pool word is a figure of the record's pool step, not a rating: a re-judge keeps it
  const judged = pluginWithVerdictOnly(plugin, v, run);
  const step = poolStepOf(run);
  return judged.pin === undefined || step === undefined ? judged : { ...judged, pin: pinAfterPool(judged.pin, step)! };
}

function pluginWithVerdictOnly(plugin: SyncPlugin, v: RecordVerdict, run?: RunBlock): SyncPlugin {
  const { pin, code: _code, ...rest } = plugin;
  const word = v.measured ? pinVerdictOf(v.rating as SuitabilityRating) : undefined;
  // a rating does not make a plugin isolated: a run seen alone does, and a re-judge measures nothing. A record from before
  // the steps keeps its word until a completion has run it.
  if (word === "isolated" && run !== undefined) {
    const step = run.steps.find((s) => s.step === RUN_STEP.isolated);
    const kept = pinAfterStep(pin, step ?? { step: RUN_STEP.isolated, result: ISOLATED_RESULT.notRun });
    const refused = step?.result === ISOLATED_RESULT.refused;
    return { ...rest, outcome: refused ? "refused" : outcomeOfVerdict(v), ...(refused && step.code !== undefined ? { code: step.code } : v.deciding === undefined ? {} : { code: v.deciding }), ...(kept === undefined ? {} : { pin: kept }) };
  }
  return {
    ...rest,
    outcome: outcomeOfVerdict(v),
    ...(v.deciding === undefined ? {} : { code: v.deciding }),
    ...(pin === undefined ? {} : { pin: { uri: pin.uri, integrity: pin.integrity, ...(word === undefined ? {} : { verdict: word }) } }),
  };
}

/**
 * Every record of the scope's user layer judged again from its rows, the state's outcomes and pin words brought into line,
 * and the list of what is owed written beside the state file. A record is put only when it differs; the base is read only
 * and is never judged in place.
 */
export function rejudgeState(ctx: SyncContext, state: SyncState, now: () => string = () => new Date().toISOString()): RejudgeResult {
  const { hostProfile, stateFile } = ctx.settings;
  const by = rejudgeToolName();
  const at = now();
  const changed = changedKeys(state);
  const judged = new Map<string, QualificationRecord>();
  const owing: OwingRecord[] = [];
  let changedCount = 0;
  let unchanged = 0;
  const stored = [...ctx.store.userRecords()].sort((a, b) => (a.uri + a.offer).localeCompare(b.uri + b.offer));
  for (const s of stored) {
    const key = shadowKeyOf(s);
    const id = keyId(key);
    const label = keyLabel(key);
    if (changed.keys.has(id)) {
      owing.push({ plugin: s.uri, record: label, owes: [{ measurement: "qualification", code: OWED_CODE.bytesChanged }] });
      continue;
    }
    let result: ReturnType<typeof rejudgeFromRows>;
    try {
      result = rejudgeFromRows(s, { host: hostProfile.id, by, at });
    } catch (e) {
      if (!(e instanceof RejudgeRefusal)) throw e;
      ctx.log(`${label}: ${e.message}; left as it is`);
      owing.push({ plugin: s.uri, record: label, owes: [{ measurement: "qualification", code: OWED_CODE.figuresUnreadable, detail: e.message }] });
      continue;
    }
    if (result.record === s.record) unchanged++;
    else {
      ctx.store.put(key, result.record);
      changedCount++;
    }
    judged.set(id, result.record);
    if (result.owes.length > 0) owing.push({ plugin: s.uri, record: label, owes: result.owes });
  }
  const entries: Record<string, SyncEntry> = {};
  for (const [key, entry] of Object.entries(state.entries)) {
    if (changed.entries.has(key)) {
      entries[key] = entry;
      continue;
    }
    const plugins = entry.plugins.map((plugin) => {
      const record = plugin.record === undefined ? undefined : judged.get(keyId(plugin.record));
      const v = record?.verdicts.find((x) => x.host === hostProfile.id);
      // a run with no step is the store's form of a record from before the steps (its run id column is required)
      if (v !== undefined) return pluginWithVerdict(plugin, v, record?.run?.steps.length === 0 ? undefined : record?.run);
      if (record === undefined && plugin.outcome === "unmeasured" && plugin.record === undefined) {
        owing.push({ plugin: plugin.uri, owes: [{ measurement: "qualification", code: OWED_CODE.noFigures }] });
      }
      return plugin;
    });
    entries[key] = { ...entry, plugins };
  }
  owing.sort((a, b) => (a.record ?? a.plugin).localeCompare(b.record ?? b.plugin));
  for (const o of owing) ctx.log(`owes: ${o.plugin}: ${o.owes.map((x) => `${x.measurement}${x.host === undefined ? "" : ` under ${x.host}`}`).join(", ")}`);
  writeIfDifferent(owedFile(stateFile), `${JSON.stringify({ schema: OWED_SCHEMA, owing }, null, 1)}\n`);
  return { state: { schema: SYNC_STATE_SCHEMA, entries }, changed: changedCount, unchanged, owing };
}

function writeIfDifferent(path: string, text: string): void {
  try {
    if (readFileSync(path, "utf8") === text) return;
  } catch {
    // not there yet
  }
  writeFileWhole(path, text);
}

// --- the memory-only pass ---------------------------------------------------------------------------------------------

/**
 * A memory-only run's footprints in a record: the `memory` of each cell and nothing else of it, a cell the record's grid
 * does not hold joined with no other figure. A cell the run could not read says why instead of a figure, so that it is
 * never read as fitting. Pure.
 */
export function mergeMemoryRun(record: QualificationRecord, output: ProbeOutput, cells: readonly GridCell[]): QualificationRecord {
  const grid: RecordGridPoint[] = [...record.measurements.grid];
  const said: { rate: number; quantum: number; outcome: string; memoryLimit?: { bytes: number; mechanism: string } }[] = [];
  for (const c of cells) {
    const p = output.grid.find((g) => cellKey(g) === cellKey(c));
    const outcome = p?.outcome ?? output.run.outcome;
    const memory = p?.memory ?? { unmeasuredReason: unmeasuredWordOf(outcome), unmeasuredDetail: `the memory-only run ended ${outcome}` };
    const figures = memoryOfCell({ rate: c.rate, quantum: c.quantum, outcome, memory });
    const at = grid.findIndex((g) => cellKey(g) === cellKey(c));
    if (at >= 0) grid[at] = { ...grid[at]!, ...figures };
    else grid.push({ rate: c.rate, quantum: c.quantum, outcome: PROBE_OK, latency: { unmeasuredReason: "not-attempted", code: HOSTING_CODE.latencyUnmeasured }, ...figures });
    said.push({ rate: c.rate, quantum: c.quantum, outcome, ...(p?.memoryLimit === undefined ? {} : { memoryLimit: p.memoryLimit }) });
  }
  const notMeasured = record.notMeasured ?? [];
  return {
    ...record,
    measurements: { ...record.measurements, grid },
    notMeasured: notMeasured.some((n) => n.dimension === MEMORY_PASS_NOT_MEASURED.dimension) ? notMeasured : [...notMeasured, MEMORY_PASS_NOT_MEASURED],
    memoryRun: { tool: output.run.tools, measuredAt: output.run.startedAt, runId: output.run.id, cells: said },
  };
}

/** Whether a record already holds this pass's footprints. */
const memoryTaken = (record: QualificationRecord, cells: readonly GridCell[]): boolean =>
  record.memoryRun !== undefined && cells.every((c) => record.memoryRun!.cells.some((m) => cellKey(m) === cellKey(c)));

export interface MemoryPassResult {
  readonly measured: number;
  readonly already: number;
  readonly failed: number;
}

/** The extensions a record was measured with: its offer says which it is. */
const offerOf = (key: ShadowKey): readonly string[] => (key.offer === "custom" ? OMX_CLAP_HOST_CONFIGURED_EXTENSIONS : []);

/**
 * The footprint of each plugin of the state, at `MEMORY_PASS_CELLS`, merged into the record its verdict for this run's host
 * came from. One plugin's failure is that plugin's; each record is written whole as its plugin ends, so a pass cut short
 * keeps what it finished, and a pass run again skips those unless `force`.
 */
export function memoryPass(ctx: SyncContext, state: SyncState, options: { readonly force?: boolean; readonly run?: ProbeRun } = {}): MemoryPassResult {
  const { memory, budgetS, memoryNotes } = ctx.settings;
  const count = { measured: 0, already: 0, failed: 0 };
  const changed = changedKeys(state);
  for (const [key, entry] of Object.entries(state.entries)) {
    if (changed.entries.has(key)) {
      ctx.log(`${key}: its files changed since it was measured; the sync measures it whole`);
      continue;
    }
    for (const plugin of entry.plugins) {
      if (plugin.record === undefined) continue;
      const record = ctx.store.record(plugin.record);
      if (record === undefined) {
        ctx.log(`${plugin.uri}: its record ${keyLabel(plugin.record)} is not in the store; no footprint taken`);
        count.failed++;
        continue;
      }
      if (options.force !== true && memoryTaken(record, MEMORY_PASS_CELLS)) {
        count.already++;
        continue;
      }
      const started = Date.now();
      const env = { ...ctx.env, [PROBE_MEMORY_ONLY_ENV]: "1", [PROBE_NOTES_ENV]: String(memoryNotes) };
      const limits = { rates: [...new Set(MEMORY_PASS_CELLS.map((c) => c.rate))], cells: MEMORY_PASS_CELLS, wallS: budgetS, ...(memory === undefined ? {} : { memory }), ...(options.run === undefined ? {} : { run: options.run }) };
      try {
        const probed =
          entry.format === "clap"
            ? probeTarget(clapTarget(key, entry, record), { ...limits, offer: offerOf(plugin.record), env })
            : lv2World(entry.root, (world) => probeTarget({ format: "lv2", uri: record.plugin.id, bundle: entry.root }, { ...limits, env: { ...env, LV2_PATH: world } }));
        if (probed.output.binary.sha256 !== record.binary.sha256) throw new ProbeRunnerError(`measured binary ${probed.output.binary.sha256.slice(0, 12)}, the record's is ${record.binary.sha256.slice(0, 12)}`);
        ctx.store.put(plugin.record, mergeMemoryRun(record, probed.output, MEMORY_PASS_CELLS));
        count.measured++;
        ctx.log(`${plugin.uri}: footprint taken at ${MEMORY_PASS_CELLS.map(cellKey).join(", ")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      } catch (e) {
        if (!(e instanceof ProbeRunnerError)) throw e;
        count.failed++;
        ctx.log(`${plugin.uri}: no footprint: ${e.message}`);
      }
    }
  }
  return count;
}

function clapTarget(key: string, entry: SyncEntry, record: QualificationRecord): PluginTarget {
  const file = key.startsWith("clap:") ? key.slice("clap:".length) : join(entry.root, record.binary.files[0]?.path ?? "");
  return { format: "clap", uri: `urn:clap:${record.plugin.id}`, bundle: entry.root, binary: basename(file), binaryPath: file };
}
