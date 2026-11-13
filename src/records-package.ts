// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify-records-package`: the Debian package of a device's qualification records, so other devices of the
 * machine class install them as the distributed layer instead of measuring the same plugin set again.
 *
 * A record set is per machine class, rate and quantum (#317). In: the qualification directories of a run, one per
 * cell it was measured at, as plugin-qualify-sync leaves them, or the run's root holding `b<rate>-<quantum>/qualification`.
 * Out: one `plugin-db-qualification-<class>-<set>-<rate>-<quantum>_<version>_all.deb` per cell, a package of plugin-db's
 * qualification layer, installing every record of that cell and the probe output it judged under
 * `/usr/share/omx/qualification/<class>/<set>-<rate>-<quantum>/`, beside the set's `provenance.json`, which names the
 * cell. A directory's cell is the one its base is named for (`b48000-512`), else `--cell`, else the one cell every
 * record's grid holds; a record whose grid does not hold its set's cell stays out, named. A record goes in only with its probe output, byte for byte the copy the record names;
 * an unmeasured record never applies and stays out. The archive is written here, `ar` and two `tar.xz` members, so a
 * machine without dpkg builds it too; the tar members are GNU tar's, owned by root, in name order, at one time.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { cellKey, type GridCell } from "./measurement-grid.js";
import { DISTRIBUTED_DIR_SYSTEM, recordCells, DISTRIBUTED_PROVENANCE_FILE, DISTRIBUTED_PROVENANCE_SCHEMA, type DistributedProvenance } from "./distributed-records.js";
import { sha256Hex } from "./probe-output.js";
import { QUALIFICATION_RECORD_SCHEMA } from "./qualification-record.js";
import { TEXT_CODE, type TextRef } from "./text-codes.js";

export interface RecordsPackageArgs {
  /** Qualification directories, or run roots holding `b<rate>-<quantum>/qualification`: one set per cell. */
  readonly sources: readonly string[];
  /** The cell of a lone directory whose name says none. */
  readonly cell?: GridCell;
  readonly hostClass: string;
  readonly set: string;
  /** A JSON file, or the JSON itself. */
  readonly provenance: string;
  readonly version?: string;
  readonly out: string;
  readonly maintainer: string;
}

export const RECORDS_PACKAGE_MAINTAINER = "Pau Aliagas <linuxnow@gmail.com>";

/** A word a Debian package name can hold: lowercase letters, digits, `+`, `-` and `.`, a letter or digit first. */
const DEB_WORD = /^[a-z0-9][a-z0-9+.-]*$/;
/** dpkg counts Installed-Size in kibibytes. */
const KIB = 2 ** 10;
const DEB_VERSION = /^[0-9][A-Za-z0-9.+~]*$/;

export function recordsPackageHelp(): string {
  return [
    "plugin-qualify-records-package: the Debian package of a device's qualification records, for the distributed layer",
    "",
    "  plugin-qualify-records-package <qualification dir|run root>... --host-class <class> --set <set> --provenance <json> [options]",
    "",
    "  one package per cell (rate and quantum): each qualification directory is a cell, named by its base",
    "  (<run>/b48000-512/qualification); a run root stands for every b<rate>-<quantum>/qualification under it",
    "",
    "  --host-class <class>     the machine class the records were measured on (rpi5): the directory they install in",
    "  --set <set>              the plugin set they cover (zynthian-vangelis); each package's set is <set>-<rate>-<quantum>",
    "  --cell <rate>/<quantum>  the cell of a lone directory not named b<rate>-<quantum> whose records hold several",
    "  --provenance <json>      a JSON file, or the JSON itself: the image, the package versions, the source revisions",
    "  --version <version>      the package's version (default: today, 2026.10.29)",
    "  --out <dir>              where the .deb is written (default: .)",
    "  --maintainer <who>       the package's Maintainer field",
    "  --help                   this text",
    "",
    `each package installs ${DISTRIBUTED_DIR_SYSTEM}/<class>/<set>-<rate>-<quantum>/ and depends on this plugin-qualify's minor, up to the next one`,
    "exit 0 every package was written, 2 one could not be",
    "",
  ].join("\n");
}

export function parseRecordsPackageArgs(argv: readonly string[]): { ok: true; args: RecordsPackageArgs } | { ok: true; help: true } | { ok: false; error: TextRef } {
  const values = new Map<string, string>();
  const positional: string[] = [];
  const valued = new Set(["--host-class", "--set", "--cell", "--provenance", "--version", "--out", "--maintainer"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help") return { ok: true, help: true };
    if (valued.has(a)) {
      const v = argv[++i];
      if (v === undefined) return { ok: false, error: { code: TEXT_CODE.cliNeedsValue, args: { option: a } } };
      values.set(a, v);
    } else if (a.startsWith("--")) return { ok: false, error: { code: TEXT_CODE.cliUnknownArgument, args: { argument: a } } };
    else positional.push(a);
  }
  if (positional.length === 0) return { ok: false, error: { code: TEXT_CODE.recordsNameDirectory } };
  for (const flag of ["--host-class", "--set", "--provenance"]) if (!values.has(flag)) return { ok: false, error: { code: TEXT_CODE.cliIsNeeded, args: { option: flag } } };
  const hostClass = values.get("--host-class")!;
  const set = values.get("--set")!;
  for (const [what, v] of [["--host-class", hostClass], ["--set", set]] as const) {
    if (!DEB_WORD.test(v)) return { ok: false, error: { code: TEXT_CODE.recordsPackageWord, args: { what: what, value: v } } };
  }
  const cellText = values.get("--cell");
  const cell = cellText === undefined ? undefined : parseCell(cellText);
  if (cellText !== undefined && cell === undefined) return { ok: false, error: { code: TEXT_CODE.recordsCellUnread, args: { cell: cellText } } };
  if (cell !== undefined && positional.length !== 1) return { ok: false, error: { code: TEXT_CODE.recordsCellOneDirectory } };
  const version = values.get("--version");
  if (version !== undefined && !DEB_VERSION.test(version)) return { ok: false, error: { code: TEXT_CODE.recordsVersionUnread, args: { version: version } } };
  return {
    ok: true,
    args: {
      sources: positional,
      ...(cell === undefined ? {} : { cell }),
      hostClass,
      set,
      provenance: values.get("--provenance")!,
      ...(version === undefined ? {} : { version }),
      out: values.get("--out") ?? ".",
      maintainer: values.get("--maintainer") ?? RECORDS_PACKAGE_MAINTAINER,
    },
  };
}

function parseCell(text: string): GridCell | undefined {
  const m = /^(\d+)\/(\d+)$/.exec(text.trim());
  if (m === null) return undefined;
  const [rate, quantum] = [Number(m[1]), Number(m[2])];
  return rate > 0 && quantum > 0 && Number.isSafeInteger(rate) && Number.isSafeInteger(quantum) ? { rate, quantum } : undefined;
}

/** A run's base directory names its cell: `b48000-512`. */
const BASE_NAME = /^b(\d+)-(\d+)$/;

/** The set of a cell: `<set>-<rate>-<quantum>`. */
export const recordsSetName = (set: string, cell: GridCell): string => `${set}-${String(cell.rate)}-${String(cell.quantum)}`;

/** One qualification directory of a run and the cell its name says, when it says one. */
export interface RecordsSource {
  readonly dir: string;
  readonly named?: GridCell;
}

/**
 * The qualification directories the arguments stand for, in name order: a directory holding records is one; a run
 * root stands for every `b<rate>-<quantum>/qualification` (or `b<rate>-<quantum>` holding records) under it.
 */
export function recordsSources(args: readonly string[]): RecordsSource[] {
  const holdsRecords = (d: string): boolean => {
    try {
      return readdirSync(d).some((n) => n.endsWith(".qualification.json") || n.endsWith(".unmeasured.json"));
    } catch {
      return false;
    }
  };
  const namedBy = (d: string): GridCell | undefined => {
    for (const part of [basename(d), basename(dirname(d))]) {
      const m = BASE_NAME.exec(part);
      if (m !== null) return { rate: Number(m[1]), quantum: Number(m[2]) };
    }
    return undefined;
  };
  const out: RecordsSource[] = [];
  for (const a of args) {
    const dir = resolve(a);
    statSync(dir);
    if (holdsRecords(dir)) {
      const named = namedBy(dir);
      out.push({ dir, ...(named === undefined ? {} : { named }) });
      continue;
    }
    const bases = readdirSync(dir).filter((n) => BASE_NAME.test(n)).sort();
    let found = 0;
    for (const b of bases) {
      for (const d of [join(dir, b, "qualification"), join(dir, b)]) {
        if (!holdsRecords(d)) continue;
        out.push({ dir: d, named: namedBy(d)! });
        found++;
        break;
      }
    }
    if (found === 0) throw new Error(`${dir} holds no record and no b<rate>-<quantum> base with records`);
  }
  return out;
}

/** The package of a class and a set. */
export const recordsPackageName = (hostClass: string, set: string): string => `plugin-db-qualification-${hostClass}-${set}`;

/** The plugin-qualify a package of records depends on: the minor that wrote them, up to the next minor. */
export function recordsDependsRange(version: string): { floor: string; ceiling: string } | undefined {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (m === null) return undefined;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return { floor: `${String(major)}.${String(minor)}.0`, ceiling: `${String(major)}.${String(minor + 1)}` };
}

/** This plugin-qualify's own version, read where it is installed. */
function ownVersion(): string {
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "";
}

/** Today as a package version, `2026.10.29`, and as a date, `2026-10-29`, in local time. */
export function today(now = new Date()): { version: string; date: string } {
  const p = (n: number): string => String(n).padStart(2, "0");
  const [y, m, d] = [String(now.getFullYear()), p(now.getMonth() + 1), p(now.getDate())];
  return { version: `${y}.${m}.${d}`, date: `${y}-${m}-${d}` };
}

/** The files of a qualification directory that go in the package: each record with its probe output, and what stays out, by name and why. */
export function collectRecords(stateDir: string, cell?: GridCell): { records: string[]; files: string[]; left: { name: string; why: TextRef }[] } {
  const names = readdirSync(stateDir).sort();
  const records: string[] = [];
  const files: string[] = [];
  const left: { name: string; why: TextRef }[] = [];
  for (const name of names) {
    if (name.endsWith(".unmeasured.json")) {
      left.push({ name, why: { code: TEXT_CODE.recordsLeftUnmeasured } });
      continue;
    }
    if (!name.endsWith(".qualification.json")) continue;
    let record: { schema?: unknown; probe?: { file?: unknown; sha256?: unknown }; measurements?: { grid?: readonly GridCell[] } };
    try {
      record = JSON.parse(readFileSync(join(stateDir, name), "utf8"));
    } catch {
      left.push({ name, why: { code: TEXT_CODE.recordsLeftUnreadable } });
      continue;
    }
    if (record.schema !== QUALIFICATION_RECORD_SCHEMA || typeof record.probe?.file !== "string" || record.probe.file.includes("/")) {
      left.push({ name, why: { code: TEXT_CODE.recordsLeftNotRecord, args: { schema: QUALIFICATION_RECORD_SCHEMA } } });
      continue;
    }
    const cells = gridCellsOf(record);
    if (cell !== undefined && !cells.includes(cellKey(cell))) {
      left.push({ name, why: cells.length === 0 ? { code: TEXT_CODE.recordsLeftNoCell, args: { cell: cellKey(cell) } } : { code: TEXT_CODE.recordsLeftOtherCell, args: { cells: cells.join(", "), cell: cellKey(cell) } } });
      continue;
    }
    let probe: Buffer;
    try {
      probe = readFileSync(join(stateDir, record.probe.file));
    } catch {
      left.push({ name, why: { code: TEXT_CODE.recordsLeftNoProbeOutput, args: { file: record.probe.file } } });
      continue;
    }
    if (sha256Hex(probe) !== record.probe.sha256) {
      left.push({ name, why: { code: TEXT_CODE.recordsLeftProbeOutputOther, args: { file: record.probe.file } } });
      continue;
    }
    records.push(name);
    files.push(name, record.probe.file);
  }
  return { records, files: [...new Set(files)].sort(), left };
}

/** The cells of a record's grid, `rate/quantum`, by rate then quantum: `recordCells`, keyed. */
const gridCellsOf = (record: { measurements?: { grid?: readonly GridCell[] } }): string[] =>
  recordCells({ measurements: { grid: Array.isArray(record.measurements?.grid) ? record.measurements.grid : [] } } as unknown as Parameters<typeof recordCells>[0]).map(cellKey);

/**
 * The cell of a source: its base's name, else the one given, else the one cell every record of it holds alone.
 * Throws, naming the cells, when none decides it.
 */
export function cellOfSource(source: RecordsSource, given?: GridCell): GridCell {
  if (source.named !== undefined) return source.named;
  if (given !== undefined) return given;
  const seen = new Set<string>();
  for (const name of readdirSync(source.dir).filter((n) => n.endsWith(".qualification.json"))) {
    try {
      for (const c of gridCellsOf(JSON.parse(readFileSync(join(source.dir, name), "utf8")))) seen.add(c);
    } catch {
      // a record that does not read is named by the collection, and decides no cell
    }
  }
  if (seen.size === 1) return parseCell([...seen][0]!)!;
  throw new Error(`${source.dir}: its records are measured at ${seen.size === 0 ? "no cell" : [...seen].join(", ")}; a set is one cell: name the base b<rate>-<quantum> or give --cell`);
}

/** The provenance argument read: a file's JSON, or the JSON itself. */
function readProvenanceArg(arg: string): Record<string, unknown> {
  const text = arg.trimStart().startsWith("{") ? arg : readFileSync(arg, "utf8");
  const v = JSON.parse(text) as unknown;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("--provenance is not a JSON object");
  return v as Record<string, unknown>;
}

// --- the archive ------------------------------------------------------------------------------------------------------

/** One `ar` member header: name, time, owner, group, mode, size, as dpkg reads them. */
function arHeader(name: string, size: number, mtime: number): Buffer {
  const field = (v: string, n: number): string => v.padEnd(n, " ").slice(0, n);
  return Buffer.from(`${field(name, 16)}${field(String(mtime), 12)}${field("0", 6)}${field("0", 6)}${field("100644", 8)}${field(String(size), 10)}\`\n`, "latin1");
}

function writeAr(path: string, members: readonly { name: string; bytes: Buffer }[], mtime: number): void {
  const fd = openSync(path, "w", 0o644);
  try {
    writeSync(fd, Buffer.from("!<arch>\n"));
    for (const m of members) {
      writeSync(fd, arHeader(m.name, m.bytes.length, mtime));
      writeSync(fd, m.bytes);
      if (m.bytes.length % 2 === 1) writeSync(fd, Buffer.from("\n"));
    }
  } finally {
    closeSync(fd);
  }
}

/** A tree as a `tar.xz`, every entry `./`-rooted, owned by root, in name order, at `mtime`. */
function tarXz(tree: string, out: string, mtime: number): void {
  const r = spawnSync(
    "tar",
    ["--create", "--xz", "--format=gnu", "--owner=0", "--group=0", "--numeric-owner", "--sort=name", `--mtime=@${String(mtime)}`, "--mode=u=rwX,go=rX", "-f", out, "-C", tree, "."],
    { encoding: "utf8", env: { ...process.env, XZ_OPT: "-6" } },
  );
  if (r.status !== 0) throw new Error(`tar: ${r.error?.message ?? r.stderr.trim()}`);
}

export interface BuiltRecordsPackage {
  readonly path: string;
  /** The set, `<set>-<rate>-<quantum>`, and its cell. */
  readonly set: string;
  readonly cell: GridCell;
  readonly name: string;
  readonly version: string;
  readonly records: number;
  /** The files the package installs. */
  readonly files: number;
  readonly left: readonly { name: string; why: TextRef }[];
}

/**
 * One package per cell of `args.sources`, written into `args.out`, in the order of the cells. Every source's cell is
 * decided and no two may share one before any package is written; throws, naming why, when one cannot be built.
 */
export function buildRecordsPackages(args: RecordsPackageArgs, now = new Date()): BuiltRecordsPackage[] {
  const sources = recordsSources(args.sources);
  if (args.cell !== undefined && sources.length !== 1) throw new Error("--cell names the cell of one directory, and these are several");
  const cells = sources.map((s) => ({ source: s, cell: cellOfSource(s, args.cell) }));
  const seen = new Map<string, string>();
  for (const { source, cell } of cells) {
    const other = seen.get(cellKey(cell));
    if (other !== undefined) throw new Error(`${source.dir} and ${other} are both measured at ${cellKey(cell)}: one set per cell`);
    seen.set(cellKey(cell), source.dir);
  }
  return cells
    .sort((a, b) => a.cell.rate - b.cell.rate || a.cell.quantum - b.cell.quantum)
    .map(({ source, cell }) => buildRecordsPackage({ ...args, stateDir: source.dir, cell }, now));
}

/** The package of one cell's directory, written into `args.out`. Throws, naming why, when it cannot be built. */
function buildRecordsPackage(args: RecordsPackageArgs & { readonly stateDir: string; readonly cell: GridCell }, now: Date): BuiltRecordsPackage {
  const set = recordsSetName(args.set, args.cell);
  const name = recordsPackageName(args.hostClass, set);
  const range = recordsDependsRange(ownVersion());
  if (range === undefined) throw new Error("this plugin-qualify names no version, so the package cannot say which one reads it");
  const day = today(now);
  const version = args.version ?? day.version;
  statSync(args.stateDir);
  const { records, files, left } = collectRecords(args.stateDir, args.cell);
  if (records.length === 0) throw new Error(`${args.stateDir} holds no record that can go in the package`);
  const provenance: DistributedProvenance = {
    ...readProvenanceArg(args.provenance),
    schema: DISTRIBUTED_PROVENANCE_SCHEMA,
    set,
    hostClass: args.hostClass,
    cell: { rate: args.cell.rate, quantum: args.cell.quantum },
    package: { name, version },
    date: day.date,
  };
  const work = mkdtempSync(join(tmpdir(), "records-package-"));
  try {
    const data = join(work, "data");
    const rel = join("usr", "share", "omx", "qualification", args.hostClass, set);
    const dir = join(data, rel);
    mkdirSync(dir, { recursive: true });
    for (const f of files) copyFileSync(join(args.stateDir, f), join(dir, f));
    writeFileSync(join(dir, DISTRIBUTED_PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`);
    const installed = [...files, DISTRIBUTED_PROVENANCE_FILE].sort();
    let kib = 0;
    const sums: string[] = [];
    for (const f of installed) {
      const bytes = readFileSync(join(dir, f));
      kib += Math.ceil(bytes.length / KIB);
      sums.push(`${createHash("md5").update(bytes).digest("hex")}  ${join(rel, f)}`);
    }
    const control = join(work, "control");
    mkdirSync(control);
    writeFileSync(
      join(control, "control"),
      [
        `Package: ${name}`,
        `Version: ${version}`,
        "Architecture: all",
        `Maintainer: ${args.maintainer}`,
        `Installed-Size: ${String(kib)}`,
        `Depends: plugin-qualify (>= ${range.floor}~), plugin-qualify (<< ${range.ceiling}~)`,
        "Section: sound",
        "Priority: optional",
        "Multi-Arch: foreign",
        `Description: plugin-db qualification layer: ${args.set} set for ${args.hostClass} at ${String(args.cell.rate)} Hz, ${String(args.cell.quantum)} frames`,
        ` The qualification layer of the plugin database: the plugin-qualify records`,
        ` of the ${args.set} plugin set, measured on a ${args.hostClass} device at ${String(args.cell.rate)} Hz`,
        ` and a quantum of ${String(args.cell.quantum)} frames. plugin-qualify-sync takes a plugin from them instead of`,
        " measuring it, and only when every file of the installed plugin hashes as the",
        " measured one did; any other plugin is measured on the device as before.",
        "",
      ].join("\n"),
    );
    writeFileSync(join(control, "md5sums"), `${sums.join("\n")}\n`);
    const mtime = Math.floor(now.getTime() / 1000);
    tarXz(control, join(work, "control.tar.xz"), mtime);
    tarXz(data, join(work, "data.tar.xz"), mtime);
    mkdirSync(args.out, { recursive: true });
    const path = join(args.out, `${name}_${version}_all.deb`);
    writeAr(
      path,
      [
        { name: "debian-binary", bytes: Buffer.from("2.0\n") },
        { name: "control.tar.xz", bytes: readFileSync(join(work, "control.tar.xz")) },
        { name: "data.tar.xz", bytes: readFileSync(join(work, "data.tar.xz")) },
      ],
      mtime,
    );
    return { path, set, cell: args.cell, name, version, records: records.length, files: installed.length, left };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// --- reading one back -------------------------------------------------------------------------------------------------

export interface ReadDeb {
  readonly members: readonly string[];
  readonly debianBinary: string;
  readonly control: Readonly<Record<string, string>>;
  /** The control member's files, `./`-rooted. */
  readonly controlFiles: readonly string[];
  /** The data member's regular files, `./`-rooted, sorted. */
  readonly files: readonly string[];
}

/** A `.deb` read with nothing but `ar`'s layout and tar: its members, its control fields, its files; unpacked into `into` when given. */
export function readDeb(path: string, into?: string): ReadDeb {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).toString("latin1") !== "!<arch>\n") throw new Error(`${path}: not an ar archive`);
  const members = new Map<string, Buffer>();
  for (let at = 8; at < bytes.length; ) {
    const head = bytes.subarray(at, at + 60).toString("latin1");
    const name = head.slice(0, 16).trim().replace(/\/$/, "");
    const size = Number(head.slice(48, 58).trim());
    members.set(name, bytes.subarray(at + 60, at + 60 + size));
    at += 60 + size + (size % 2);
  }
  const work = mkdtempSync(join(tmpdir(), "read-deb-"));
  try {
    const list = (member: string, extract?: string): string[] => {
      const file = join(work, member);
      writeFileSync(file, members.get(member) ?? Buffer.alloc(0));
      const r = spawnSync("tar", ["-tvJf", file], { encoding: "utf8", maxBuffer: 256 << 20 });
      if (r.status !== 0) throw new Error(`${member}: ${r.stderr.trim()}`);
      if (extract !== undefined) {
        mkdirSync(extract, { recursive: true });
        const x = spawnSync("tar", ["-xJf", file, "-C", extract], { encoding: "utf8" });
        if (x.status !== 0) throw new Error(`${member}: ${x.stderr.trim()}`);
      }
      return r.stdout
        .split("\n")
        .filter((l) => l.startsWith("-"))
        .map((l) => l.slice(l.indexOf("./")))
        .sort();
    };
    const controlDir = join(work, "control");
    const controlFiles = list("control.tar.xz", controlDir);
    const control: Record<string, string> = {};
    for (const line of readFileSync(join(controlDir, "control"), "utf8").split("\n")) {
      const m = /^([A-Za-z-]+): (.*)$/.exec(line);
      if (m !== null) control[m[1]!] = m[2]!;
    }
    return {
      members: [...members.keys()],
      debianBinary: (members.get("debian-binary") ?? Buffer.alloc(0)).toString("latin1"),
      control,
      controlFiles,
      files: list("data.tar.xz", into),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
