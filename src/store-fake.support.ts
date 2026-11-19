// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A stand-in for the two commands of the qualification store, in memory, for the tests of what the sync does with them
 * (`plugin-qualification-db-write put|delete`, `plugin-qualification-db query|counts`). It follows the interface the store
 * spec documents (sections 3.7 and 6) and nothing else: the layer a record is written to, the shadowing of a base record
 * by a user record of the same shadow key, the refusals of a record's list and path, and the JSON shapes each verb prints.
 * It is a stand-in in tests only; the commands themselves are exercised by `qualification-store.contract.test.ts`.
 */
import type { QualificationRecord } from "./qualification-record.js";
import type { StoredRecord, StoreRun, StoreRunResult } from "./qualification-store.js";

const key = (s: Pick<StoredRecord, "sha256" | "format" | "uri" | "offer" | "host_class">): string => [s.sha256, s.format, s.uri, s.offer, s.host_class].join("\0");

export interface FakeStore {
  readonly run: StoreRun;
  /** The user layer's records, in the order written. */
  readonly user: () => StoredRecord[];
  /** Every call, as `<tool> <args>`. */
  readonly calls: string[];
  /** The base, which only the test writes. */
  readonly base: StoredRecord[];
  /** True once a call was made while the store was `absent`. */
  absent: boolean;
}

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
 */
export function fakeStore(options: { readonly absent?: boolean; readonly base?: readonly StoredRecord[]; readonly validate?: boolean } = {}): FakeStore {
  const user: StoredRecord[] = [];
  const calls: string[] = [];
  const base: StoredRecord[] = [...(options.base ?? [])];
  const store: FakeStore = { run: undefined as unknown as StoreRun, user: () => [...user], calls, base, absent: false };
  const ok = (stdout = ""): StoreRunResult => ({ status: 0, stdout, stderr: "" });
  const merged = (layer: string | undefined): StoredRecord[] => {
    if (layer === "user") return user;
    if (layer === "base") return base;
    const shadowed = new Set(user.map(key));
    return [...user, ...base.filter((b) => !shadowed.has(key(b)))];
  };
  const matching = (records: StoredRecord[], args: readonly string[]): StoredRecord[] => {
    const want = { sha256: flag(args, "--sha256"), format: flag(args, "--format"), uri: flag(args, "--uri"), offer: flag(args, "--offer"), host_class: flag(args, "--host-class") };
    const binaryPath = flag(args, "--binary-path");
    return records.filter((r) => Object.entries(want).every(([k, v]) => v === undefined || (r as any)[k] === v) && (binaryPath === undefined || r.record.binary.path === binaryPath));
  };
  const run: StoreRun = (tool, args, input) => {
    calls.push(`${tool} ${args.join(" ")}`);
    if (options.absent === true || store.absent) {
      store.absent = true;
      return { status: 1, stdout: "", stderr: "qualification-db.absent: the base file does not exist" };
    }
    const verb = args[0];
    if (tool === "write") {
      if (verb === "put") {
        const record = JSON.parse(input ?? "{}") as QualificationRecord;
        const bad = options.validate === false ? undefined : refusalOf(record);
        if (bad !== undefined) return { status: 1, stdout: "", stderr: `plugin-qualification-db-write: put: ${bad.code}: ${bad.path}: ${bad.word}` };
        const stored: StoredRecord = { layer: "user", sha256: record.binary?.sha256 ?? "0".repeat(64), format: record.plugin.format, uri: record.plugin.id, offer: flag(args, "--offer")!, host_class: flag(args, "--host-class")!, record };
        const at = user.findIndex((u) => key(u) === key(stored));
        if (at >= 0) user[at] = stored;
        else user.push(stored);
        return ok();
      }
      if (verb === "delete") {
        const gone = matching(user, args);
        for (const g of gone) user.splice(user.indexOf(g), 1);
        return ok();
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
      if (args.includes("--records")) {
        if (args.includes("--rate") || args.includes("--quantum")) return { status: 2, stdout: "", stderr: "--rate and --quantum are refused with --records" };
        return ok(found.map((r) => `${JSON.stringify(r)}\n`).join(""));
      }
      const lines = found.flatMap((r) =>
        r.record.measurements.grid.map((cell) => ({
          layer: r.layer, sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, host_class: r.host_class, set: null,
          pkg_format: null, pkg_name: null, pkg_version: null, pkg_release: null, pkg_distro: null, pkg_arch: null,
          binary_path: r.record.binary.path, layout_scheme: r.record.binary.layout?.scheme ?? null, layout_sha256: r.record.binary.layout?.sha256 ?? null,
          tested_version: r.record.testedVersion ?? null, unpinnable: r.record.binary.unpinnable === undefined ? 0 : 1,
          files: r.record.binary.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
          rate: cell.rate, quantum: cell.quantum, outcome: cell.outcome,
          verdicts: r.record.verdicts.map((v) => ({ host: v.host, rating: v.rating, deciding: v.deciding ?? null, measured: v.measured, qualified: v.qualified })),
        })),
      );
      return ok(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    }
    return { status: 2, stdout: "", stderr: `plugin-qualification-db: unknown verb ${String(verb)}` };
  };
  return Object.assign(store, { run });
}
