// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sync's calls into the qualification store (the store spec, sections 6 and 6.1). The store is not ours: its commands
 * are `plugin-qualification-db-write` (`put`, `delete`) and `plugin-qualification-db` (`query`, `counts`), run the way
 * plugin-db's are (`plugin-db-cli.ts`): a command that is not installed is named, a refusal is surfaced by the code it
 * gives, and nothing here opens a database, hashes a file or reads a record file.
 *
 * `QualificationStore` is one scope's view: the user layer's records are listed once and kept current by its own writes,
 * so a run asks the reader a few times, not a plugin at a time.
 *
 * An absent base is an empty base layer (the store spec, section 6.1): the reader answers from the scope's layer alone,
 * exits 0, keeps standard output for records and says so in one line on standard error,
 * `plugin-qualification-db: base-absent: <path>: the base layer is empty`. That line is kept as a signal, never read as a
 * record; standard output is read line by line, and a line that is not what the verb prints is refused as `store-output`.
 * A base that exists and cannot be used is the reader's refusal by name (`qualification-db.unreadable`, `not-a-store`,
 * `schema-other`).
 */
import { spawnSync } from "node:child_process";

import type { QualificationRecord } from "./qualification-record.js";

/** The writer command, else `plugin-qualification-db-write` on the PATH; for tests and packagers. */
export const STORE_WRITE_ENV = "PLUGIN_QUALIFICATION_DB_WRITE";
/** The reader command, else `plugin-qualification-db` on the PATH. */
export const STORE_READ_ENV = "PLUGIN_QUALIFICATION_DB";

export type StoreTool = "write" | "read";

export interface StoreRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The command is not installed. */
  readonly missing?: boolean;
}

/** One run of a store command, the document on standard input when one is given. */
export type StoreRun = (tool: StoreTool, args: readonly string[], input?: string, env?: Readonly<Record<string, string | undefined>>) => StoreRunResult;

const COMMAND = { write: "plugin-qualification-db-write", read: "plugin-qualification-db" } as const;

export const SPAWNED_STORE: StoreRun = (tool, args, input, env = process.env) => {
  const named = env[tool === "write" ? STORE_WRITE_ENV : STORE_READ_ENV];
  const r = spawnSync(named !== undefined && named !== "" ? named : COMMAND[tool], args, { encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 30, env: { ...env }, ...(input === undefined ? {} : { input }) });
  const missing = (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(missing ? { missing } : {}) };
};

/** A store command's refusal, by the code it gave. The message is the command's own words. */
export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The refusals of the writer (section 3.7) and the reader's `qualification-db.*` names. */
const CODE = /\b(path-absolute|binary-not-in-files|key-not-the-binary|files-unordered|files-duplicate|files-empty|field-unmapped|word-unknown|qualification-db\.[a-z-]+|contract\.[a-z.-]+)\b/;

/** What a command that did not succeed said, as an error: its code and its last line, or what was missing. */
function failure(tool: StoreTool, verb: string, r: StoreRunResult): StoreError {
  if (r.missing === true) return new StoreError("command-missing", `command missing: ${COMMAND[tool]}`);
  const line = r.stderr.trim().split("\n").pop() || `${COMMAND[tool]} ${verb} exited ${String(r.status)}`;
  if (r.status === 2 && CODE.exec(line) === null) return new StoreError("usage", `unknown verb ${verb} or flag of ${COMMAND[tool]}: ${line}`);
  return new StoreError(CODE.exec(line)?.[1] ?? "refused", `${COMMAND[tool]} ${verb}: ${line}`);
}

/** A record's identity in the store: what shadows what (section 4). */
export interface ShadowKey {
  readonly sha256: string;
  readonly format: string;
  readonly uri: string;
  readonly offer: string;
  readonly hostClass: string;
}

/** `query --json --records`: one record and the key the store holds it under. */
export interface StoredRecord {
  readonly layer: "user" | "base";
  readonly sha256: string;
  readonly format: string;
  readonly uri: string;
  readonly offer: string;
  readonly host_class: string;
  readonly record: QualificationRecord;
}

/** `query --json`: one cell of a record. */
export interface StoredResult {
  readonly layer: "user" | "base";
  readonly sha256: string;
  readonly format: "clap" | "lv2";
  readonly uri: string;
  readonly offer: string;
  readonly host_class: string;
  readonly set: string | null;
  readonly binary_path: string;
  readonly layout_scheme: string | null;
  readonly layout_sha256: string | null;
  readonly tested_version: string | null;
  readonly unpinnable: 0 | 1;
  /** The record's per-file list in its order, never empty. */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  readonly rate: number;
  readonly quantum: number;
  readonly outcome: string;
  /** An array in the record's order of the reader's `pqdb_verdict` fields: `measured` and `qualified` are 0 or 1, `deciding` a word or null. */
  readonly verdicts: readonly { readonly host: string; readonly rating: string; readonly deciding: string | null; readonly measured: 0 | 1; readonly qualified: 0 | 1 }[];
}

export interface StoreCounts {
  readonly format: string;
  readonly plugins: number;
  readonly offered: number;
  readonly not_offered: number;
}

export const shadowKeyOf = (r: Pick<StoredRecord, "sha256" | "format" | "uri" | "offer" | "host_class">): ShadowKey => ({ sha256: r.sha256, format: r.format, uri: r.uri, offer: r.offer, hostClass: r.host_class });
export const sameKey = (a: ShadowKey, b: ShadowKey): boolean => a.sha256 === b.sha256 && a.format === b.format && a.uri === b.uri && a.offer === b.offer && a.hostClass === b.hostClass;

/** A key as a map key. */
export const keyId = (k: ShadowKey): string => [k.sha256, k.format, k.uri, k.offer, k.hostClass].join("\0");
/** A key as a person reads it, in the sync's log and the list of what is owed. */
export const keyLabel = (k: ShadowKey): string => `${k.uri} (${k.offer}, ${k.sha256.slice(0, 12)})`;

/** The reader's line on standard error when there is no base file: the base layer is empty. */
const BASE_ABSENT = /^plugin-qualification-db: base-absent: (.+): the base layer is empty$/m;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A line of `query --json [--records]`: an object of a layer, and with `--records` the record in it. */
const isRecordLine = (v: unknown): boolean => isObject(v) && (v["layer"] === "user" || v["layer"] === "base") && isObject(v["record"]);
const isResultLine = (v: unknown): boolean => isObject(v) && (v["layer"] === "user" || v["layer"] === "base") && Array.isArray(v["files"]);
const isCountsLine = (v: unknown): boolean => isObject(v) && typeof v["format"] === "string" && typeof v["plugins"] === "number";

/** Standard output, one JSON object a line, each what the verb prints; anything else is refused by name, never skipped. */
function lines(text: string, verb: string, is: (v: unknown) => boolean): unknown[] {
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      let v: unknown;
      try {
        v = JSON.parse(l);
      } catch {
        v = undefined;
      }
      if (!is(v)) throw new StoreError("store-output", `plugin-qualification-db ${verb}: a line of its output is not what ${verb} prints: ${l.slice(0, 200)}`);
      return v;
    });
}

export class QualificationStore {
  private user: StoredRecord[] | undefined;
  private readonly run: StoreRun;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private absentBase: string | undefined;
  private readonly baseAbsentListeners: ((path: string) => void)[] = [];

  /** `scope` is the sync's: `system` under `--system`, else the user's. `onBaseAbsent` hears, once, that the base is absent. */
  constructor(
    readonly scope: "user" | "system",
    options: { readonly run?: StoreRun; readonly env?: Readonly<Record<string, string | undefined>>; readonly onBaseAbsent?: (path: string) => void } = {},
  ) {
    this.run = options.run ?? SPAWNED_STORE;
    this.env = options.env ?? process.env;
    if (options.onBaseAbsent !== undefined) this.baseAbsentListeners.push(options.onBaseAbsent);
  }

  /** The base file's path when the reader said it is absent (the base layer is empty); `undefined` while it has not. */
  get baseAbsent(): string | undefined {
    return this.absentBase;
  }

  /** `fn` hears the absent base once: now, if the reader already said so, else at the first read that says it. */
  whenBaseAbsent(fn: (path: string) => void): void {
    if (this.absentBase !== undefined) fn(this.absentBase);
    else this.baseAbsentListeners.push(fn);
  }

  private read(verb: string, args: readonly string[]): string {
    const r = this.run("read", [verb, "--scope", this.scope, ...args], undefined, this.env);
    if (r.missing === true || r.status !== 0) throw failure("read", verb, r);
    const absent = BASE_ABSENT.exec(r.stderr);
    if (absent !== null && this.absentBase === undefined) {
      this.absentBase = absent[1]!;
      for (const fn of this.baseAbsentListeners.splice(0)) fn(this.absentBase);
    }
    return r.stdout;
  }

  /** `put`: the record replaces the layer's record of the key, whole; a refusal throws with the writer's code and path. */
  put(key: ShadowKey, record: QualificationRecord): void {
    const r = this.run("write", ["put", "--scope", this.scope, "--offer", key.offer, "--host-class", key.hostClass], JSON.stringify(record), this.env);
    if (r.missing === true || r.status !== 0) throw failure("write", "put", r);
    if (this.user !== undefined) this.user = [...this.user.filter((u) => !sameKey(shadowKeyOf(u), key)), { layer: "user", sha256: key.sha256, format: key.format, uri: key.uri, offer: key.offer, host_class: key.hostClass, record }];
  }

  /** `delete`: the layer's record of the key; a key the layer does not hold is not an error. */
  delete(key: ShadowKey): void {
    const r = this.run("write", ["delete", "--scope", this.scope, "--sha256", key.sha256, "--format", key.format, "--uri", key.uri, "--offer", key.offer, "--host-class", key.hostClass], undefined, this.env);
    if (r.missing === true || r.status !== 0) throw failure("write", "delete", r);
    if (this.user !== undefined) this.user = this.user.filter((u) => !sameKey(shadowKeyOf(u), key));
  }

  /** Every record of the scope's user layer (`query --json --records --layer user`), listed once. */
  userRecords(): readonly StoredRecord[] {
    this.user ??= lines(this.read("query", ["--json", "--records", "--layer", "user"]), "query --records", isRecordLine) as StoredRecord[];
    return this.user;
  }

  /** Every record of the scope, the user layer over the base (`query --json --records`, no layer named). */
  scopeRecords(): StoredRecord[] {
    return lines(this.read("query", ["--json", "--records"]), "query --records", isRecordLine) as StoredRecord[];
  }

  /** The user layer's record of a key. */
  record(key: ShadowKey): QualificationRecord | undefined {
    return this.userRecords().find((u) => sameKey(shadowKeyOf(u), key))?.record;
  }

  /** The cells of the records of a plugin, the user layer first, a base record only where the user has none of its key. */
  results(filter: { readonly format: string; readonly uri?: string; readonly hostClass: string; readonly binaryPath?: string }): StoredResult[] {
    const args = ["--json", "--format", filter.format, ...(filter.uri === undefined ? [] : ["--uri", filter.uri]), ...(filter.binaryPath === undefined ? [] : ["--binary-path", filter.binaryPath]), "--host-class", filter.hostClass];
    return lines(this.read("query", args), "query", isResultLine) as StoredResult[];
  }

  /** The records of the merged answer for a plugin's shadow keys, whole (`query --json --records`, no layer). */
  recordsOf(filter: { readonly sha256: string; readonly format: string; readonly uri: string; readonly offer: string; readonly hostClass: string; readonly layer?: "user" | "base" }): StoredRecord[] {
    const args = ["--json", "--records", ...(filter.layer === undefined ? [] : ["--layer", filter.layer]), "--sha256", filter.sha256, "--format", filter.format, "--uri", filter.uri, "--offer", filter.offer, "--host-class", filter.hostClass];
    return lines(this.read("query", args), "query --records", isRecordLine) as StoredRecord[];
  }

  /** What the scope's own layer holds per format: `counts --layer user --json`. */
  counts(): StoreCounts[] {
    return lines(this.read("counts", ["--layer", "user", "--json"]), "counts", isCountsLine) as StoreCounts[];
  }
}
