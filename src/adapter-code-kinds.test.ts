// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The kinds of an adapter code and the outcome plugin-qualify's own memory bound writes are items of the qualification
 * domain (1.3.0), and the code that composes them reads them from it: no kind and no outcome is spelled in the source.
 * An adapter code is `<host>.<kind>[-<parameter>]`: `resp-<n>` is the kind `resp` with an integer, `signal-<SIG>` the kind
 * `signal` with a probe signal word (plugin-hostd's domain owns those words; they are composed as they come).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ADAPTER_HOST, ADMITTED_HOSTS, admitPlugin, classifyJalvRun, classifyProtocolRun, type JalvRun, type ModHostRun } from "./host-admission.js";
import { HISTORY_REASON } from "./history-adjust.js";
import { PIN_VERDICTS } from "./pins-file.js";
import { isOutOfMemory } from "./memory-bound.js";
import { init } from "./qualification-domain.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";
import { ISOLATED_CODE } from "./qualify-isolated.js";
import { POOL_CODE } from "./qualify-pool.js";
import { noPrivateServerCode } from "./qualify-adapter-pass.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");
type Word = { const: string; title: string; "x-code": number; "x-since"?: string };
type Doc = { info: { version: string }; components: { schemas: Record<string, { "x-since"?: string; oneOf: Word[] }> } };
const original = JSON.parse(readFileSync(join(INSTALLED_CONTRACT_DIR, "qualification", "qualification.json"), "utf8")) as Doc;
const clone = (): Doc => JSON.parse(JSON.stringify(original)) as Doc;
const wordsOf = (doc: Doc, item: string): Word[] => doc.components.schemas[item]?.oneOf ?? [];
const KINDS = "QUALIFICATION_ADAPTER_CODE_KINDS";
const OUTCOMES = "QUALIFICATION_MEMORY_BOUND_OUTCOMES";

afterEach(() => init(original));

const mod = (run: Partial<ModHostRun>): ModHostRun => ({ installed: true, steps: [], ...run });
const jalv = (run: Partial<JalvRun>): JalvRun => ({ installed: true, stillRunning: false, status: null, signal: null, stderr: "", ...run });
const add = (extra: object): ModHostRun["steps"] => [{ cmd: "add", ...extra }];
const A = ADAPTER_HOST;
/** Every kind the composer writes: its title, the word it is spelled as, the code a run composes, and the run. */
const KIND_RUNS: { title: string; word: string; code: string; run: () => string | undefined }[] = [
  { title: "resp", word: "resp", code: `${A}.resp-102`, run: () => classifyProtocolRun(A, mod({ steps: add({ resp: -102 }) })).code },
  { title: "signal", word: "signal", code: `${A}.signal-SIGSEGV`, run: () => classifyProtocolRun(A, mod({ steps: add({ died: "SIGSEGV" }) })).code },
  { title: "diedOnAdd", word: "died-on-add", code: `${A}.died-on-add`, run: () => classifyProtocolRun(A, mod({ steps: add({ died: "exit" }) })).code },
  { title: "died", word: "died", code: `${A}.died`, run: () => classifyProtocolRun(A, mod({ steps: [{ cmd: "remove", died: "closed" }] })).code },
  { title: "noAnswer", word: "no-answer", code: `${A}.no-answer`, run: () => classifyProtocolRun(A, mod({ steps: add({}) })).code },
  { title: "noJackClient", word: "no-jack-client", code: `${A}.no-jack-client`, run: () => classifyProtocolRun(A, mod({ steps: add({ resp: -201 }) })).code },
  { title: "notStarted", word: "not-started", code: `${A}.not-started`, run: () => classifyProtocolRun(A, mod({ started: false })).code },
  { title: "notInstalled", word: "not-installed", code: `${A}.not-installed`, run: () => classifyProtocolRun(A, mod({ installed: false })).code },
  { title: "silentUnderNote", word: "silent-under-note", code: `${A}.silent-under-note`, run: () => classifyProtocolRun(A, mod({ steps: add({ resp: 0 }), sound: { peak: 0 } })).code },
  { title: "levelUnmeasured", word: "level-unmeasured", code: `${A}.level-unmeasured`, run: () => classifyProtocolRun(A, mod({ steps: add({ resp: 0 }), sound: {} })).code },
  {
    title: "silentNeedsContent",
    word: "silent-needs-content",
    code: `${A}.silent-needs-content`,
    run: () => classifyProtocolRun(A, mod({ steps: add({ resp: 0 }), sound: { peak: 0, content: { params: ["p"], loaded: [] } } })).code,
  },
  {
    title: "admissionFailed",
    word: "admission-failed",
    code: "jalv.admission-failed",
    run: () =>
      admitPlugin("jalv", "urn:x", {
        modHost: () => mod({}),
        jalv: () => {
          throw new Error("no answer");
        },
      }).code,
  },
  { title: "unknownPortType", word: "unknown-port-type", code: "jalv.unknown-port-type", run: () => classifyJalvRun(jalv({ status: 1, stderr: 'Mandatory port "p" has unknown type' })).code },
  { title: "noPrivateServer", word: "no-private-server", code: `${A}.no-private-server`, run: () => noPrivateServerCode() },
  { title: "exit", word: "exit", code: "jalv.exit-3", run: () => classifyJalvRun(jalv({ status: 3 })).code },
];

describe("QUALIFICATION_ADAPTER_CODE_KINDS", () => {
  it("holds every kind host-admission.ts and qualify-adapter-pass.ts compose, read from their source", () => {
    const titles = [...(read("src/host-admission.ts") + read("src/qualify-adapter-pass.ts")).matchAll(/adapterCode\(\s*[^,()]+,\s*"([A-Za-z]+)"/g)].map((m) => m[1] as string);
    expect(titles.length).toBeGreaterThan(0);
    const item = wordsOf(original, KINDS);
    expect(item.length, `${KINDS} is not an item of the domain`).toBeGreaterThan(0);
    expect([...new Set(titles)].sort()).toEqual(item.map((w) => w.title).sort());
    expect(KIND_RUNS.map((k) => k.title).sort()).toEqual(item.map((w) => w.title).sort());
  });
  it("spells each kind as the code carries it, and the composer writes that code", () => {
    for (const k of KIND_RUNS) {
      expect(wordsOf(original, KINDS).find((w) => w.title === k.title)?.const, k.title).toBe(k.word);
      expect(k.run(), k.title).toBe(k.code);
    }
  });
  it("leaves no kind spelled in the composers", () => {
    for (const file of ["src/host-admission.ts", "src/qualify-adapter-pass.ts"]) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const literal = src.match(/`\$\{[^}]+\}\.[a-z][a-z-]*`/g) ?? [];
      expect(literal, `${file} composes a code from a literal kind`).toEqual([]);
      for (const k of KIND_RUNS) expect(src, `${file} spells ${k.word}`).not.toMatch(new RegExp(k.word.includes("-") ? `["\`.]${k.word}\\b` : `\\.${k.word}[-"\`]`));
    }
  });
  it("is written as the domain spells it: a renamed kind changes the code", () => {
    const doc = clone();
    for (const w of wordsOf(doc, KINDS)) w.const = `x-${w.const}`;
    init(doc);
    for (const k of KIND_RUNS) expect(k.run(), k.title).toBe(k.code.replace(/\.(.+)$/, (_m, rest: string) => `.x-${rest}`));
  });
  it("refuses a domain short of a kind, by the item and the kind", () => {
    for (const k of KIND_RUNS) {
      const doc = clone();
      doc.components.schemas[KINDS]!.oneOf = wordsOf(doc, KINDS).filter((w) => w.title !== k.title);
      init(doc);
      expect(() => k.run(), k.title).toThrow(new RegExp(`${KINDS}.*${k.title}`));
    }
  });
});

describe("QUALIFICATION_ADAPTER_HOSTS", () => {
  const HOSTS = "QUALIFICATION_ADAPTER_HOSTS";
  const held = () => wordsOf(original, HOSTS).map((w) => w.const);
  /** The check an adapter code's host and record.adapter_host meet: a word of the item, not a judge profile. */
  const hostOfCode = (code: string): string => code.split(".")[0] as string;
  it("holds exactly the hosts the producers run a plugin under, read from the source", () => {
    expect(held().length, `${HOSTS} is not an item of the domain`).toBeGreaterThan(0);
    expect([...new Set([ADAPTER_HOST, ...ADMITTED_HOSTS])].sort()).toEqual([...held()].sort());
    expect(held().sort()).toEqual(["jalv", "mod-host", "omx-clap-host"]);
  });
  it("admits the host of every code the composers write, mod-host and jalv included", () => {
    const codes = [classifyProtocolRun("mod-host", mod({ steps: add({ resp: -102 }) })).code, classifyJalvRun(jalv({ status: 3 })).code, classifyProtocolRun(A, mod({ installed: false })).code];
    expect(codes).toEqual(["mod-host.resp-102", "jalv.exit-3", "omx-clap-host.not-installed"]);
    for (const c of codes) expect(held(), c).toContain(hostOfCode(c ?? ""));
  });
  it("refuses a host the item does not hold, and a judge profile that is no host a plugin ran under", () => {
    for (const w of ["carla", "openmixer-console", "openmixer-pi-4gb"]) expect(held()).not.toContain(w);
  });
  it("is not the host profiles: mod-host and jalv are no word of QUALIFICATION_HOST_PROFILES", () => {
    const profiles = wordsOf(original, "QUALIFICATION_HOST_PROFILES").map((w) => w.const);
    expect(profiles).not.toContain("jalv");
    expect(profiles).not.toContain("mod-host");
  });
});

describe("the pin and history items hold exactly the words plugin-qualify's code writes", () => {
  const held = (item: string) => wordsOf(original, item).map((w) => w.const).sort();
  const blockers = /function blockers\([\s\S]*?\n}\n/.exec(read("src/history-adjust.ts"))?.[0] ?? "";
  const moves = /export type HistoryMove = ([^;]+);/.exec(read("src/history-adjust.ts"))?.[1] ?? "";
  const words = (src: string) => [...src.matchAll(/"([a-z][a-z-]*)"/g)].map((m) => m[1] as string);
  it("QUALIFICATION_PIN_VERDICTS is PIN_VERDICTS of pins-file.ts", () => {
    expect(held("QUALIFICATION_PIN_VERDICTS")).toEqual([...PIN_VERDICTS].sort());
  });
  it("QUALIFICATION_HISTORY_MOVES is the HistoryMove type of history-adjust.ts", () => {
    expect(words(moves).length).toBe(3);
    expect(held("QUALIFICATION_HISTORY_MOVES")).toEqual(words(moves).sort());
  });
  it("QUALIFICATION_HISTORY_REASONS is the codes of HISTORY_REASON", () => {
    expect(held("QUALIFICATION_HISTORY_REASONS")).toEqual(Object.values(HISTORY_REASON).sort());
  });
  it("QUALIFICATION_HISTORY_BLOCKERS is the words blockers() writes that are no reason code", () => {
    const written = [...blockers.matchAll(/\["([a-z-]+)"\]/g)].map((m) => m[1] as string);
    expect(written.sort()).toEqual(["no-deciding-reason", "refused", "unknown"]);
    expect(held("QUALIFICATION_HISTORY_BLOCKERS")).toEqual(written);
  });
});

describe("QUALIFICATION_STEP_CODES", () => {
  it("holds every code the isolated and the pool step tables hold, read from the producers", () => {
    const produced = [...Object.values(ISOLATED_CODE), ...Object.values(POOL_CODE)];
    expect(produced.length).toBeGreaterThan(0);
    const held = wordsOf(original, "QUALIFICATION_STEP_CODES").map((w) => w.const);
    expect(produced.filter((c) => !held.includes(c))).toEqual([]);
    expect(held.filter((c) => !produced.includes(c as never))).toEqual([]);
  });
});

describe("QUALIFICATION_MEMORY_BOUND_OUTCOMES", () => {
  it("holds probe.oom, the word memory-bound.ts writes when its own bound ends a run", () => {
    expect(wordsOf(original, OUTCOMES).map((w) => w.const)).toEqual(["probe.oom"]);
  });
  it("leaves no outcome spelled in memory-bound.ts", () => {
    expect(read("src/memory-bound.ts")).not.toMatch(/"probe\.oom"/);
  });
  it("is read from the domain: a renamed word is the one an out-of-memory run is known by", () => {
    const doc = clone();
    wordsOf(doc, OUTCOMES)[0]!.const = "probe.out-of-memory";
    init(doc);
    expect(isOutOfMemory("probe.out-of-memory")).toBe(true);
    expect(isOutOfMemory("probe.oom")).toBe(false);
  });
  it("refuses a domain short of the item, by name", () => {
    const doc = clone();
    delete doc.components.schemas[OUTCOMES];
    init(doc);
    expect(() => isOutOfMemory("probe.oom")).toThrow(new RegExp(OUTCOMES));
  });
  it("leaves probe.memory-limit, plugin-hostd's word, in the source", () => {
    expect(read("src/memory-bound.ts")).toContain('export const PROBE_MEMORY_LIMIT = "probe.memory-limit"');
  });
});

describe("x-since names the version of the domain document that first carried the item", () => {
  const V120 = [
    "HOST_CLASSES", "SET_TIERS", "HOST_PROFILES", "SYNC_SETTINGS", "OFFERS", "PACKAGE_FORMATS", "PACKAGE_DISTROS", "PACKAGE_ARCHES",
    "VERDICT_HOSTINGS", "VERDICT_ARMS", "REASON_PARAMS", "REASON_PARAM_WORDS", "RECORD_TIERS", "MEMORY_LIMIT_MECHANISMS", "NOTE_SWEEP_DIALECTS",
    "RUN_STEPS", "STEP_RESULTS", "STEP_CODES", "REJUDGE_OWES", "REJUDGE_MEASUREMENTS",
  ].map((n) => `QUALIFICATION_${n}`);
  const V130 = [KINDS, OUTCOMES];
  const V140 = ["ADAPTER_HOSTS", "PIN_VERDICTS", "HISTORY_MOVES", "HISTORY_REASONS", "HISTORY_BLOCKERS"].map((n) => `QUALIFICATION_${n}`);
  const semver = (v: string) => v.split(".").map(Number);
  const above = (a: string, b: string) => {
    const [x, y] = [semver(a), semver(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
  };
  it("is a version the document has had: never above its own, never the package's", () => {
    for (const [item, schema] of Object.entries(original.components.schemas)) {
      expect(schema["x-since"], `${item} has no x-since`).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
      expect(above(schema["x-since"] as string, original.info.version), `${item} x-since ${String(schema["x-since"])} is above ${original.info.version}`).toBe(false);
    }
  });
  it("is 1.0.0 for the items the domain was created with, 1.2.0 for the record store's, 1.3.0 for the adapter's, 1.4.0 for its hosts", () => {
    for (const [item, schema] of Object.entries(original.components.schemas)) {
      const want = V140.includes(item) ? "1.4.0" : V130.includes(item) ? "1.3.0" : V120.includes(item) ? "1.2.0" : "1.0.0";
      expect(schema["x-since"], item).toBe(want);
    }
    // plugin-hostd dropped QUALIFICATION_MACHINE_CLASSES, which nothing reads (ownership map rows 5 and 20): 17 items with it, 16 without
    const dropped = original.components.schemas.QUALIFICATION_MACHINE_CLASSES === undefined ? 1 : 0;
    expect(Object.keys(original.components.schemas)).toHaveLength(17 - dropped + V120.length + V130.length + V140.length);
  });
  it("the domain is 1.4.0 or later, the version that carries the items this package reads", () => {
    expect(above(original.info.version, "1.3.99")).toBe(true);
  });
});
