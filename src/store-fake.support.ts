// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A stand-in for the two commands of the qualification store, in memory, for the tests of what the sync does with them
 * (`plugin-qualification-db-write put|delete`, `plugin-qualification-db query|counts`). It follows the interface the store
 * spec documents (sections 3.7 and 6) and nothing else: the layer a record is written to, the shadowing of a base record
 * by a user record of the same shadow key, the refusals of a record's list and path, and the JSON shapes each verb prints.
 * The base's claim (section 4) is the test's to give: a base record claims the cells `claims` names, else every cell of
 * its grid. A cell result is the claimant's, a record line names its `set`, and `query --json --records --rate R
 * --quantum Q` prints the record that claims the cell, whole. The stand-in never decides a claim: who wins a cell is
 * the store's rule, and the test states the store's answer.
 * It is a stand-in in tests only; the commands themselves are exercised by `qualification-store.contract.test.ts`.
 */
import type { QualificationRecord } from "./qualification-record.js";
import type { StoredRecord, StoreRun, StoreRunResult } from "./qualification-store.js";

/** A base record as the test puts it: its set, and the cells the store's claim gives it (every cell of its grid when absent). */
export type FakeBaseRecord = StoredRecord & { readonly set?: string | null; readonly claims?: readonly { readonly rate: number; readonly quantum: number }[] };

const key = (s: Pick<StoredRecord, "sha256" | "format" | "uri" | "offer" | "host_class">): string => [s.sha256, s.format, s.uri, s.offer, s.host_class].join("\0");

export interface FakeStore {
  readonly run: StoreRun;
  /** The user layer's records, in the order written. */
  readonly user: () => StoredRecord[];
  /** Every call, as `<tool> <args>`. */
  readonly calls: string[];
  /** The base, which only the test writes. */
  readonly base: FakeBaseRecord[];
}

/** Where the reader opens the base, as it names it in the `base-absent` line. */
export const FAKE_BASE_PATH = "/usr/share/omx/qualification/qualification.sqlite";
/** The one line the reader writes on standard error when the base file is absent: the base layer is empty (store spec 6). */
export const BASE_ABSENT_LINE = `plugin-qualification-db: base-absent: ${FAKE_BASE_PATH}: the base layer is empty`;

const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};

/** A refusal of a record as the writer words it: the code, the path and the word. */
export function refusalOf(record: QualificationRecord): { code: string; path: string; word: string } | undefined {
  const files = record.binary.files;
  const abs = [record.binary.path, ...files.map((f) => f.path)].find((p) => p.startsWith("/"));
  if (abs !== undefined) return { code: "path-absolute", path: abs, word: abs };
  if (files.length === 0) return { code: "files-empty", path: "binary.files", word: "" };
  for (let i = 1; i < files.length; i++) {
    if (files[i]!.path === files[i - 1]!.path) return { code: "files-duplicate", path: files[i]!.path, word: files[i]!.path };
    if (Buffer.compare(Buffer.from(files[i]!.path), Buffer.from(files[i - 1]!.path)) < 0) return { code: "files-unordered", path: files[i]!.path, word: files[i]!.path };
  }
  const main = files.find((f) => f.path === record.binary.path);
  if (main === undefined) return { code: "binary-not-in-files", path: record.binary.path, word: record.binary.path };
  if (main.sha256 !== record.binary.sha256) return { code: "key-not-the-binary", path: record.binary.path, word: record.binary.sha256 };
  return undefined;
}

/**
 * `validate: false` is for the unit tests of what a pass does to a record's run, whose records are not whole: the writer's
 * refusals (section 3.7) are not enforced and a record with no binary is stored under the key `0...0`.
 *
 * `baseAbsent`: no base file. The reader answers from the user layer alone, exits 0, keeps standard output for records and
 * writes the one `base-absent` line on standard error, as plugin-db-qualification's reader does from 2026112001.
 * `baseRefused`: a base that exists and cannot be used. Every read exits 1 with that code first on standard error
 * (`qualification-db.unreadable`, `qualification-db.not-a-store`, `qualification-db.schema-other`); the writer is not
 * affected, since it never opens the base.
 */
export function fakeStore(options: { readonly baseAbsent?: boolean; readonly baseRefused?: string; readonly base?: readonly FakeBaseRecord[]; readonly validate?: boolean } = {}): FakeStore {
  const user: StoredRecord[] = [];
  const calls: string[] = [];
  const base: FakeBaseRecord[] = [...(options.base ?? [])];
  const cellId = (c: { rate: number; quantum: number }): string => `${String(c.rate)}/${String(c.quantum)}`;
  /** The cells a record claims: a user record every cell of its grid, a base record what the test gave it. */
  const claimed = (r: FakeBaseRecord): { rate: number; quantum: number }[] => [...(r.claims ?? r.record.measurements.grid)].map((c) => ({ rate: c.rate, quantum: c.quantum }));
  // the claim's primary key: one record per key and cell in the base (the store refuses two, claim-duplicate)
  const owner = new Map<string, FakeBaseRecord>();
  for (const b of base)
    for (const c of claimed(b)) {
      if (owner.has(`${key(b)}\0${cellId(c)}`)) throw new Error(`fakeStore: two base records claim ${b.uri} at ${cellId(c)}`);
      owner.set(`${key(b)}\0${cellId(c)}`, b);
    }
  const line = (r: FakeBaseRecord): Record<string, unknown> => ({ layer: r.layer, sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, host_class: r.host_class, set: r.layer === "user" ? null : (r.set ?? null), record: r.record });
  const store: FakeStore = { run: undefined as unknown as StoreRun, user: () => [...user], calls, base };
  const ok = (stdout = ""): StoreRunResult => ({ status: 0, stdout, stderr: options.baseAbsent === true ? `${BASE_ABSENT_LINE}\n` : "" });
  const merged = (layer: string | undefined): StoredRecord[] => {
    const theBase = options.baseAbsent === true ? [] : base;
    if (layer === "user") return user;
    if (layer === "base") return theBase;
    const shadowed = new Set(user.map(key));
    return [...user, ...theBase.filter((b) => !shadowed.has(key(b)))];
  };
  const matching = (records: StoredRecord[], args: readonly string[]): StoredRecord[] => {
    const want = { sha256: flag(args, "--sha256"), format: flag(args, "--format"), uri: flag(args, "--uri"), offer: flag(args, "--offer"), host_class: flag(args, "--host-class") };
    const binaryPath = flag(args, "--binary-path");
    return records.filter((r) => Object.entries(want).every(([k, v]) => v === undefined || (r as any)[k] === v) && (binaryPath === undefined || r.record.binary.path === binaryPath));
  };
  const run: StoreRun = (tool, args, input) => {
    calls.push(`${tool} ${args.join(" ")}`);
    const verb = args[0];
    if (tool === "read" && options.baseRefused !== undefined) return { status: 1, stdout: "", stderr: `${options.baseRefused} ${FAKE_BASE_PATH}: the base cannot be used\n` };
    if (tool === "write") {
      if (verb === "put") {
        const record = JSON.parse(input ?? "{}") as QualificationRecord;
        const bad = options.validate === false ? undefined : refusalOf(record);
        if (bad !== undefined) return { status: 1, stdout: "", stderr: `plugin-qualification-db-write: put: ${bad.code}: ${bad.path}: ${bad.word}` };
        const stored: StoredRecord = { layer: "user", sha256: record.binary?.sha256 ?? "0".repeat(64), format: record.plugin.format, uri: record.plugin.id, offer: flag(args, "--offer")!, host_class: flag(args, "--host-class")!, record };
        const at = user.findIndex((u) => key(u) === key(stored));
        if (at >= 0) user[at] = stored;
        else user.push(stored);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (verb === "delete") {
        const gone = matching(user, args);
        for (const g of gone) user.splice(user.indexOf(g), 1);
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 2, stdout: "", stderr: `usage: plugin-qualification-db-write put|delete` };
    }
    if (verb === "counts") {
      const layer = flag(args, "--layer");
      const per = new Map<string, Map<string, boolean>>();
      for (const r of merged(layer)) {
        const plugins = per.get(r.format) ?? new Map<string, boolean>();
        plugins.set(r.uri, (plugins.get(r.uri) ?? false) || r.record.tiers.offeredOn.length > 0);
        per.set(r.format, plugins);
      }
      return ok([...per.entries()].sort().map(([format, plugins]) => `${JSON.stringify({ format, plugins: plugins.size, offered: [...plugins.values()].filter(Boolean).length, not_offered: [...plugins.values()].filter((o) => !o).length })}\n`).join(""));
    }
    if (verb === "query") {
      const found = matching(merged(flag(args, "--layer")), args);
      const rate = flag(args, "--rate");
      const quantum = flag(args, "--quantum");
      const at = (c: { rate: number; quantum: number }): boolean => (rate === undefined || c.rate === Number(rate)) && (quantum === undefined || c.quantum === Number(quantum));
      const claims = (r: FakeBaseRecord): { rate: number; quantum: number }[] => claimed(r).filter(at);
      if (args.includes("--records")) {
        // a record claiming a cell the filters name; with --rate and --quantum, the one record that claims that cell
        return ok(found.filter((r) => claims(r).length > 0).map((r) => `${JSON.stringify(line(r))}\n`).join(""));
      }
      const lines = found.flatMap((r) =>
        r.record.measurements.grid.filter((cell) => claims(r).some((c) => cellId(c) === cellId(cell))).map((cell) => ({
          layer: r.layer, sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, host_class: r.host_class, set: r.layer === "user" ? null : ((r as FakeBaseRecord).set ?? null),
          pkg_format: null, pkg_name: null, pkg_version: null, pkg_release: null, pkg_distro: null, pkg_arch: null,
          binary_path: r.record.binary.path, layout_scheme: r.record.binary.layout?.scheme ?? null, layout_sha256: r.record.binary.layout?.sha256 ?? null,
          tested_version: r.record.testedVersion ?? null, unpinnable: r.record.binary.unpinnable === undefined ? 0 : 1,
          files: r.record.binary.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
          rate: cell.rate, quantum: cell.quantum, outcome: cell.outcome,
          verdicts: r.record.verdicts.map((v) => ({ host: v.host, rating: v.rating, deciding: v.deciding ?? null, measured: v.measured ? 1 : 0, qualified: v.qualified ? 1 : 0 })),
        })),
      );
      return ok(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    }
    return { status: 2, stdout: "", stderr: `plugin-qualification-db: unknown verb ${String(verb)}` };
  };
  return Object.assign(store, { run });
}
