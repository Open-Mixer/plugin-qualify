#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify` — the entry point. Every decision is a
 * pure function in `src/qualify-cli.ts`; this file only reads argv, prints and exits.
 *
 * Every named plugin, CLAP or LV2, is measured by plugin-hostd's probe runner (`plugin-hostd-probe`,
 * named by `OMX_PROBE_RUNNER` when it is not on `PATH`), which keeps the deadline and the limits, and is
 * judged from the probe output it writes: the verdict and the qualification record, per host profile.
 * `plugin-qualify compare` runs the plugins through omx-clap-host, plugin-hostd, mod-host and jalv with the same checks
 * (tools/compare-run.mjs).
 * `--all` finds the LV2 plugins of the bundles on the LV2 path, then the CLAP plugins on the standard CLAP search path (`CLAP_PATH`, then `~/.clap`, then
 * `/usr/lib/clap`). `plugin-qualify judge` judges probe outputs already written.
 */
import "../dist/qualification-cli-start.js";
import { existsSync, readFileSync } from "node:fs";

import {
  adjustHelpText,
  adjustRecords,
  adjustTable,
  adjustedPinEntries,
  parseAdjustArgs,
  readRecords,
  installedRootOf,
  QualificationStore,
  StoreError,
  discoverSyncItems,
  fileSha256,
  hostClassOf,
  parseSyncArgs,
  resolveSyncSettings,
  storedForm,
  ClapScanError,
  EXIT_CODE,
  clapLoader,
  clapPinEntries,
  judgeExitCode,
  judgedLayerHelpText,
  judgedLayerOf,
  parseJudgedLayerArgs,
  judgeFiles,
  mergeRunsByRecord,
  judgeHelpText,
  parseJudgeArgs,
  discoverAllTargets,
  exitCodeFor,
  helpText,
  lv2Loader,
  memoryBoundOf,
  parseQualifyArgs,
  pinsFile,
  qualificationRecordOf,
  qualifyTargets,
  resolveHostProfiles,
  resolveTargets,
  writeQualification,
  textTable,
  writeFileWhole,
  HOSTD_ENV,
  SYNC_CONF,
  hereFacts,
  hereHelpText,
  hereText,
  parseHereArgs,
  parseSyncConf,
  toolVersion,
} from "../dist/index.js";

/**
 * The pins file, whole or not at all: written beside the target and renamed over it, and left alone when the run took no
 * pin, so a run that measured nothing never empties the file a host is reading.
 */
function writePins(path, file) {
  for (const uri of file.skipped) process.stderr.write(`plugin-qualify: ${uri}: no whole pin was taken, so it has no line in ${path}\n`);
  for (const r of file.refused) process.stderr.write(`plugin-qualify: ${r.problem}; it has no line in ${path}\n`);
  if (file.written.length === 0) {
    process.stderr.write(`plugin-qualify: no pin was taken, ${path} is left as it was\n`);
    return;
  }
  writeFileWhole(path, file.text);
  process.stderr.write(`plugin-qualify: ${file.written.length} pin${file.written.length === 1 ? "" : "s"} written to ${path}\n`);
}

if (process.argv[2] === "compare") {
  const { compareMain } = await import("../tools/compare-run.mjs");
  process.exit(await compareMain(process.argv.slice(3)));
}

if (process.argv[2] === "judge") {
  const j = parseJudgeArgs(process.argv.slice(3));
  if (!j.ok) {
    process.stderr.write(`plugin-qualify judge: ${j.error}\n\n${judgeHelpText()}`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  if (j.args.help) {
    process.stdout.write(judgeHelpText());
    process.exit(EXIT_CODE.allQualified);
  }
  const hosts = resolveHostProfiles(j.args.hostProfiles);
  if (!hosts.ok) {
    for (const r of hosts.refused) process.stderr.write(`plugin-qualify judge: --host-profile ${r.spec}: ${r.problem}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  const hostClass = hostClassOf(j.args.hostClass);
  if (hostClass === undefined) {
    process.stderr.write("plugin-qualify judge: this machine has no host class: name one with --host-class\n");
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  const store = new QualificationStore(j.args.system ? "system" : "user");
  let result;
  try {
    result = judgeFiles(j.args.files, { profiles: hosts.profiles, store, hostClass });
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    process.stderr.write(`plugin-qualify judge: ${e.message}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  for (const f of result.failures) process.stderr.write(`plugin-qualify judge: ${f.file}: ${f.problem}\n`);
  for (const k of result.records) process.stderr.write(`plugin-qualify judge: record ${k.uri} (${k.offer}, ${k.hostClass}) put in the ${j.args.system ? "system" : "user"} layer\n`);
  process.stdout.write(
    j.args.format === "json" ? `${JSON.stringify(result.records.map((k) => store.record(k)), null, 2)}\n` : textTable(result.verdicts),
  );
  process.exit(judgeExitCode(result));
}

// the facts of here a plugin-db query is asked with (#56): text, or --json one object by plugin-db's keys
if (process.argv[2] === "here") {
  const h = parseHereArgs(process.argv.slice(3));
  if (!h.ok) {
    process.stderr.write(`plugin-qualify here: ${h.error}\n\n${hereHelpText()}`);
    process.exit(2);
  }
  const confPath = h.args.config ?? SYNC_CONF;
  let confText = "";
  try {
    confText = readFileSync(confPath, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") {
      process.stderr.write(`plugin-qualify here: ${confPath}: cannot read: ${e.message}\n`);
      process.exit(2);
    }
  }
  const conf = parseSyncConf(confText, confPath);
  if (!conf.ok) {
    process.stderr.write(`plugin-qualify here: ${conf.error}\n`);
    process.exit(2);
  }
  const facts = hereFacts({ file: conf.values, hostdVersion: toolVersion(process.env[HOSTD_ENV] ?? "plugin-hostd") });
  process.stdout.write(h.args.json ? `${JSON.stringify(facts)}\n` : hereText(facts));
  process.exit(0);
}

if (process.argv[2] === "judged-layer") {
  const j = parseJudgedLayerArgs(process.argv.slice(3));
  if (!j.ok) {
    process.stderr.write(`plugin-qualify judged-layer: ${j.error}\n\n${judgedLayerHelpText()}`);
    process.exit(2);
  }
  if ("help" in j) {
    process.stdout.write(judgedLayerHelpText());
    process.exit(0);
  }
  let record;
  try {
    record = new QualificationStore("user").recordsOf({ ...j.args.key, ...(j.args.layer === undefined ? {} : { layer: j.args.layer }) })[0]?.record;
  } catch (e) {
    process.stderr.write(`plugin-qualify judged-layer: ${e.message}\n`);
    process.exit(2);
  }
  if (record === undefined) {
    process.stderr.write(`plugin-qualify judged-layer: no record of that key in the store\n`);
    process.exit(2);
  }
  const l = judgedLayerOf(record, {
    machineClass: j.args.machineClass,
    pin: { files: j.args.files, layout: j.args.layout },
    ...(j.args.judgedBy === undefined ? {} : { judgedBy: j.args.judgedBy }),
    ...(j.args.address === undefined ? {} : { address: j.args.address }),
  });
  if (l.layer === null) {
    process.stderr.write(`plugin-qualify judged-layer: ${j.args.record}: no judged layer: ${l.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(j.args.body ? l.body : l, null, 2)}\n`);
  process.exit(0);
}

if (process.argv[2] === "adjust") {
  const a = parseAdjustArgs(process.argv.slice(3));
  if (!a.ok) {
    process.stderr.write(`plugin-qualify adjust: ${a.error}\n\n${adjustHelpText()}`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  if (a.args.help) {
    process.stdout.write(adjustHelpText());
    process.exit(EXIT_CODE.allQualified);
  }
  const hosts = resolveHostProfiles(a.args.hostProfiles);
  if (!hosts.ok) {
    for (const r of hosts.refused) process.stderr.write(`plugin-qualify adjust: --host-profile ${r.spec}: ${r.problem}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  let text;
  try {
    text = readFileSync(a.args.history, "utf8");
  } catch (e) {
    process.stderr.write(`plugin-qualify adjust: --history ${a.args.history}: cannot read: ${e.message}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  const store = new QualificationStore(a.args.system ? "system" : "user");
  let read;
  let items;
  try {
    read = readRecords(store);
    // the installed items, as the sync finds them: a record's plugin is where its key is installed
    const conf = parseSyncConf(existsSync(SYNC_CONF) ? readFileSync(SYNC_CONF, "utf8") : "");
    const sync = parseSyncArgs(a.args.system ? ["--system"] : []);
    const settings = conf.ok && sync.ok ? resolveSyncSettings(conf.values, sync.args, process.env) : undefined;
    if (settings === undefined || !settings.ok) throw new Error(settings === undefined ? "the sync's settings do not read" : settings.error);
    items = discoverSyncItems(settings.settings).items;
  } catch (e) {
    process.stderr.write(`plugin-qualify adjust: ${e.message}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  if (read.records.length === 0) {
    process.stderr.write(`plugin-qualify adjust: no record in the ${a.args.system ? "system" : "user"} scope of the qualification store (its layer over the base)\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  const hashOf = (path) => {
    try {
      return fileSha256(path);
    } catch {
      return undefined;
    }
  };
  const now = a.args.now ?? Math.floor(Date.now() / 1000);
  const done = adjustRecords(read.records, text, { profiles: hosts.profiles, file: a.args.history, now, rootOf: (key, record) => installedRootOf(items, key, record, hashOf), ...(a.args.hostClass === undefined ? {} : { hostClass: a.args.hostClass }) });
  if (!done.ok) {
    process.stderr.write(`plugin-qualify adjust: ${done.problem}\n`);
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  if (a.args.pins !== undefined && done.hostClasses.length !== 1) {
    process.stderr.write(
      `plugin-qualify adjust: --pins writes one adjusted verdict per plugin, and ${a.args.history} holds ${String(done.hostClasses.length)} host classes (${done.hostClasses.join(", ")}); name one with --host-class\n`,
    );
    process.exit(EXIT_CODE.couldNotMeasure);
  }
  for (const i of done.ignored) process.stderr.write(`plugin-qualify adjust: ${a.args.history}:${String(i.line)}: not read: ${i.problem}\n`);
  for (const n of done.notInstalled) process.stderr.write(`plugin-qualify adjust: ${n.key.uri} (${n.key.offer}): ${n.code}: no installed item holds this record's key; left as it is\n`);
  for (const r of done.records) {
    try {
      store.put(r.key, storedForm(r.record));
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      process.stderr.write(`plugin-qualify adjust: ${r.key.uri}: ${e.message}\n`);
      process.exit(EXIT_CODE.couldNotMeasure);
    }
    process.stderr.write(`plugin-qualify adjust: record ${r.key.uri} (${r.key.offer}) put\n`);
  }
  if (a.args.pins !== undefined) writePins(a.args.pins, pinsFile(adjustedPinEntries(done.records, done.hostClasses[0], hosts.profiles[0].id)));
  process.stdout.write(a.args.format === "json" ? `${JSON.stringify(done.records.map((r) => r.record), null, 2)}\n` : adjustTable(done.records));
  process.exit(EXIT_CODE.allQualified);
}

const parsed = parseQualifyArgs(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`plugin-qualify: ${parsed.error}\n\n${helpText()}`);
  process.exit(EXIT_CODE.couldNotMeasure);
}
if (parsed.args.help) {
  process.stdout.write(helpText());
  process.exit(EXIT_CODE.allQualified);
}
const profiles = resolveHostProfiles(parsed.args.hostProfiles);
if (!profiles.ok) {
  for (const r of profiles.refused) process.stderr.write(`plugin-qualify: --host-profile ${r.spec}: ${r.problem}\n`);
  process.exit(EXIT_CODE.couldNotMeasure);
}
for (const p of profiles.profiles) process.stderr.write(`plugin-qualify: host profile ${p.id} (${p.isolation})\n`);
let plugins;
try {
  if (parsed.args.all) plugins = discoverAllTargets();
  else {
    const r = resolveTargets(parsed.args.targets, [clapLoader(), lv2Loader]);
    if (!r.ok) {
      process.stderr.write(`plugin-qualify: no plugin found for: ${r.refused.join(", ")}\n`);
      process.exit(EXIT_CODE.couldNotMeasure);
    }
    plugins = r.plugins;
  }
} catch (e) {
  if (!(e instanceof ClapScanError)) throw e;
  process.stderr.write(`plugin-qualify: ${e.message}\n`);
  process.exit(EXIT_CODE.couldNotMeasure);
}
for (const p of plugins) process.stderr.write(`plugin-qualify: target ${p.uri}${p.bundle ? ` (${p.bundle})` : ""}\n`);
if (plugins.length === 0) {
  process.stderr.write("plugin-qualify: no plugin to measure\n");
  process.exit(EXIT_CODE.couldNotMeasure);
}
if (parsed.args.all) {
  const lv2 = plugins.filter((p) => p.format === "lv2").length;
  process.stderr.write(`plugin-qualify: --all qualifies ${String(lv2)} LV2 and ${String(plugins.length - lv2)} CLAP plugins on the search paths\n`);
}
const memory = memoryBoundOf(parsed.args.memoryLimit);
process.stderr.write(`plugin-qualify: memory bound ${memory === undefined ? "off" : `${String(memory.bytes)} bytes (${memory.mechanism})`}\n`);
const pass = qualifyTargets(plugins, {
  rates: parsed.args.rates,
  quanta: parsed.args.quanta,
  grid: parsed.args.grid,
  cellsPerPluginBudget: parsed.args.cellsPerPluginBudget,
  ...(parsed.args.blocks === undefined ? {} : { blocks: parsed.args.blocks }),
  ...(memory === undefined ? {} : { memory }),
  profiles: profiles.profiles,
});
for (const f of pass.failures) process.stderr.write(`plugin-qualify: ${f.uri}: ${f.problem}\n`);
if (parsed.args.out !== undefined) {
  for (const run of mergeRunsByRecord(pass.runs)) {
    const w = writeQualification(parsed.args.out, run.bytes, run.judgment, [], run.stderr);
    for (const p of w.stderrPaths) process.stderr.write(`plugin-qualify: stderr ${p}\n`);
    process.stderr.write(`plugin-qualify: record ${w.recordPath}\n`);
  }
}
if (parsed.args.pins !== undefined) writePins(parsed.args.pins, pinsFile(clapPinEntries(pass.documents, profiles.profiles[0].id)));
process.stdout.write(
  parsed.args.format === "json"
    ? `${JSON.stringify(pass.runs.map((r) => qualificationRecordOf(r.bytes, r.judgment)), null, 2)}\n`
    : textTable(pass.verdicts),
);
process.exit(exitCodeFor(pass.verdicts));
