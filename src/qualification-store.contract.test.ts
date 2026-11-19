// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The commands the sync calls, as the store spec documents them (section 6 and 6.1), run for real: no stand-in, no skip.
 * Each test fails with the name of what is missing until the repository that owns the commands ships it
 * (`command missing: plugin-qualification-db-write`, `unknown verb counts`), and turns green as each lands.
 *
 * Nothing here writes a layer: a refusal writes nothing, and the read verbs only read. The positive round trip (put, query,
 * delete) is proved against the stand-in of `store-fake.support.ts` in `qualification-store.test.ts`, and against the
 * commands once they take a layer path the tests may name.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FIXTURES, LV2_CLEAN } from "./qualify-rejudge.support.js";
import { shippedHostProfile, type HostProfile } from "./host-profiles.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { buildQualificationRecord } from "./qualification-record.js";
import { readProbeOutput } from "./probe-output.js";
import { storeExport } from "./store-export.support.js";

const WRITE = process.env["PLUGIN_QUALIFICATION_DB_WRITE"] ?? "plugin-qualification-db-write";
const READ = process.env["PLUGIN_QUALIFICATION_DB"] ?? "plugin-qualification-db";

/**
 * The commands check words against every domain of a contract directory, not this package's one: the test setup's own
 * override of OMX_CONTRACT_PATH is not theirs. They read the installed directory, or the one STORE_CONTRACT_DIR names (a
 * run whose installed contract packages are older than the domains the store needs).
 */
const commandEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  const dir = env["STORE_CONTRACT_DIR"];
  if (dir !== undefined && dir !== "") env["OMX_CONTRACT_PATH"] = dir;
  else delete env["OMX_CONTRACT_PATH"];
  return env;
};

function run(command: string, args: string[], input?: string) {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, env: commandEnv(), ...(input === undefined ? {} : { input }) });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") throw new Error(`command missing: ${command}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A valid LV2 record as the store holds it: today's writer over a fixture probe output, judged for the profiles the domain names. */
function record() {
  const probe = readProbeOutput(readFileSync(join(FIXTURES, `${LV2_CLEAN}.probe.json`), "utf8"));
  if (!probe.ok) throw new Error(probe.problem);
  const profiles = ["omx-clap-host", "openmixer-console"].map((id) => shippedHostProfile(id)).filter((p): p is HostProfile => p !== undefined);
  const made = buildQualificationRecord(judgeProbeOutput(probe.output, profiles), { file: "x.default.probe.json", sha256: "0".repeat(64), bytes: 1 });
  const exported = storeExport(made, probe.output).record;
  // the store requires the load the probe started under, which a fixture's run may not have taken
  return { ...exported, probe: { ...exported.probe, load: exported.probe.load ?? { loadavg1: 0.5, cores: 4 } } };
}

/** The writer is told to keep its layer under a directory of the test's own (`--root`, for tests): no run here touches a user's layer. */
const root = mkdtempSync(join(tmpdir(), "store-contract-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const put = (doc: unknown) => run(WRITE, ["put", "--scope", "user", "--root", root, "--offer", "default", "--host-class", "x86-64"], JSON.stringify(doc));
const del = (r: { sha256: string; format: string; uri: string }) => run(WRITE, ["delete", "--scope", "user", "--root", root, "--sha256", r.sha256, "--format", r.format, "--uri", r.uri, "--offer", "default", "--host-class", "x86-64"]);

describe("plugin-qualification-db-write put refuses what section 3.7 says it refuses, by code, naming the path", () => {
  const cases: [string, (r: any) => void, RegExp][] = [
    ["path-absolute", (r) => { r.binary.path = "/usr/lib/lv2/x.lv2/amp.so"; }, /\/usr\/lib\/lv2\/x\.lv2\/amp\.so/],
    ["path-absolute", (r) => { r.binary.files[0].path = "/etc/manifest.ttl"; }, /\/etc\/manifest\.ttl/],
    ["files-empty", (r) => { r.binary.files = []; }, /./],
    ["files-duplicate", (r) => { r.binary.files = [r.binary.files[0], ...r.binary.files]; }, /./],
    ["files-unordered", (r) => { r.binary.files = [...r.binary.files].reverse(); }, /./],
    ["binary-not-in-files", (r) => { r.binary.path = "elsewhere.so"; }, /elsewhere\.so/],
    ["key-not-the-binary", (r) => { r.binary.sha256 = "e".repeat(64); }, /./],
  ];
  for (const [code, break_, names] of cases) {
    it(`${code}`, () => {
      const r = record();
      break_(r);
      const out = put(r);
      expect(out.status, out.stderr).not.toBe(0);
      expect(out.stderr).toContain(code);
      expect(out.stderr).toMatch(names);
    });
  }
});

describe("plugin-qualification-db-write put and delete, in a layer of the test's own", () => {
  it("a valid record is put, put again to replace it, deleted, and a key the layer does not hold is no error", () => {
    const r = record();
    const key = { sha256: r.binary.sha256, format: r.plugin.format, uri: r.plugin.id };
    const first = put(r);
    expect(first.status, first.stderr).toBe(0);
    expect(readdirSync(root).length).toBeGreaterThan(0);
    const again = put({ ...r, measuredAt: "2030-01-01T00:00:00.000Z" });
    expect(again.status, again.stderr).toBe(0);
    const gone = del(key);
    expect(gone.status, gone.stderr).toBe(0);
    const none = del(key);
    expect(none.status, none.stderr).toBe(0);
  });

  it("a refusal writes nothing: the layer holds no record of it", () => {
    const r = JSON.parse(JSON.stringify(record())) as { binary: { path: string } };
    r.binary.path = `/usr/lib/${r.binary.path}`;
    const before = readdirSync(root).sort();
    expect(put(r).status).toBe(1);
    expect(readdirSync(root).sort()).toEqual(before);
  });
});

describe("plugin-qualification-db reads what the sync asks of it", () => {
  const verdict = (out: { status: number | null; stderr: string }, what: string): void => {
    // a store that is not there is a refusal by name; a verb the command does not have is a usage error
    expect(out.status, `${what}: ${out.stderr}`).not.toBe(2);
    if (out.status !== 0) expect(out.stderr).toMatch(/qualification-db\.[a-z-]+/);
  };

  it("counts --layer user --json", () => {
    const out = run(READ, ["counts", "--layer", "user", "--json"]);
    if (out.status === 2) throw new Error(`unknown verb counts: ${out.stderr.trim()}`);
    verdict(out, "counts");
    if (out.status === 0) for (const l of out.stdout.split("\n").filter(Boolean)) expect(JSON.parse(l)).toEqual({ format: expect.any(String), plugins: expect.any(Number), offered: expect.any(Number), not_offered: expect.any(Number) });
  });

  it("query --json --records --layer user: one object a record, with the record in it", () => {
    const out = run(READ, ["query", "--json", "--records", "--layer", "user"]);
    if (out.status === 2) throw new Error(`unknown flag --records or --layer: ${out.stderr.trim()}`);
    verdict(out, "query --records");
    if (out.status === 0) for (const l of out.stdout.split("\n").filter(Boolean)) expect(Object.keys(JSON.parse(l))).toEqual(["layer", "sha256", "format", "uri", "offer", "host_class", "record"]);
  });

  it("query --json --records refuses --rate: a record is not a cell", () => {
    const out = run(READ, ["query", "--json", "--records", "--rate", "48000"]);
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/records/);
  });

  it("query --json carries the per-file list of each result, never empty", () => {
    const out = run(READ, ["query", "--json", "--layer", "user"]);
    if (out.status === 2) throw new Error(`unknown flag --layer: ${out.stderr.trim()}`);
    verdict(out, "query");
    if (out.status === 0) for (const l of out.stdout.split("\n").filter(Boolean)) expect((JSON.parse(l) as { files: unknown[] }).files.length).toBeGreaterThan(0);
  });
});
