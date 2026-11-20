// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { judgeExitCode, judgeFiles, parseJudgeArgs } from "./judge-cli.js";
import { fixtureJson, fixtureText } from "./probe-output-fixtures.js";
import { QualificationStore } from "./qualification-store.js";
import { fakeStore } from "./store-fake.support.js";

const scratch = mkdtempSync(join(tmpdir(), "judge-cli-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const put = (name: string, text: string): string => {
  const p = join(scratch, name);
  writeFileSync(p, text);
  return p;
};

describe("parseJudgeArgs", () => {
  it("reads files, profiles (repeated or comma-separated, once each), the scope, the host class and the format", () => {
    const r = parseJudgeArgs(["--host-profile", "omx-clap-host,jalv", "--host-profile", "jalv", "--system", "--host-class", "rpi5", "--format", "json", "a.json", "b.json"]);
    expect(r).toEqual({ ok: true, args: { files: ["a.json", "b.json"], hostProfiles: ["omx-clap-host", "jalv"], system: true, hostClass: "rpi5", format: "json", help: false } });
    const d = parseJudgeArgs(["a.json"]);
    expect(d.ok && d.args.hostProfiles).toEqual(["openmixer-console"]);
  });

  it("refuses an unknown option, a missing value, a bad format and no file", () => {
    expect(parseJudgeArgs(["--nope", "a"])).toEqual({ ok: false, error: "unknown option --nope" });
    expect(parseJudgeArgs(["a", "--host-class"])).toEqual({ ok: false, error: "--host-class needs a value" });
    expect(parseJudgeArgs(["a", "--format", "xml"]).ok).toBe(false);
    expect(parseJudgeArgs([]).ok).toBe(false);
    expect(parseJudgeArgs(["--help"]).ok).toBe(true);
  });

  it("--qualification-dir is gone, with no alias: the records are put in the store", () => {
    expect(parseJudgeArgs(["a", "--qualification-dir", "q"])).toEqual({ ok: false, error: "unknown option --qualification-dir" });
  });
});

describe("judgeFiles", () => {
  const profiles = [OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE];
  const opened = () => {
    const fake = fakeStore();
    return { fake, store: new QualificationStore("user", { run: fake.run }) };
  };

  it("puts one record a file in the store and writes no file; the exit code follows the verdicts", () => {
    const { fake, store } = opened();
    const ok = put("ok.probe.json", fixtureText("success-msi"));
    const before = readdirSync(scratch).sort();
    const r = judgeFiles([ok], { profiles: [OMX_CLAP_HOST_PROFILE], store, hostClass: "x86-64" });
    expect(r.failures).toEqual([]);
    expect(r.verdicts.map((v) => [v.host, v.rating])).toEqual([["omx-clap-host", "suitable"]]);
    expect(judgeExitCode(r)).toBe(0);
    expect(readdirSync(scratch).sort()).toEqual(before);
    expect(fake.user().map((u) => [u.uri, u.offer, u.host_class])).toEqual([["org.example.plate", "omx-clap-host", "x86-64"]]);
    // no probe copy: the record names the output's file name and its SHA-256, which are evidence, and nothing keeps the bytes
    const record = fake.user()[0]!.record;
    expect(record.probe.sha256).toBe(createHash("sha256").update(readFileSync(ok)).digest("hex"));
    expect(record.binary.path).toBe("example-plate.clap");
    expect(judgeExitCode(judgeFiles([ok], { profiles, store, hostClass: "x86-64" }))).toBe(1);
  });

  it("a refused file is named with its code and exits 2, and the files after it are still judged", () => {
    const bad = fixtureJson("success-msi");
    bad.formatVersion = "2.0";
    const { store } = opened();
    const r = judgeFiles([put("bad.json", JSON.stringify(bad)), join(scratch, "missing.json"), put("good.json", fixtureText("success-msi"))], { profiles: [OMX_CLAP_HOST_PROFILE], store, hostClass: "x86-64" });
    expect(r.failures.map((f) => f.problem.split(":")[0])).toEqual(["probe.format.major-unknown", "cannot read"]);
    expect(r.verdicts).toHaveLength(1);
    expect(judgeExitCode(r)).toBe(2);
  });

  it("a run that crashed exits 2, its record put", () => {
    const { fake, store } = opened();
    const r = judgeFiles([put("crash.json", fixtureText("plugin-crash"))], { profiles: [OPENMIXER_CONSOLE_PROFILE], store, hostClass: "x86-64" });
    expect(r.verdicts[0]).toMatchObject({ measured: false, deciding: "probe.crashed" });
    expect(judgeExitCode(r)).toBe(2);
    expect(fake.user()).toHaveLength(1);
  });

  it("a refusal of the writer is the file's failure, by its code", () => {
    const refuse = new QualificationStore("user", { run: () => ({ status: 1, stdout: "", stderr: "plugin-qualification-db-write: refused: word-unknown: record: x: 'y' is no word" }) });
    const r = judgeFiles([put("w.json", fixtureText("success-msi"))], { profiles: [OMX_CLAP_HOST_PROFILE], store: refuse, hostClass: "x86-64" });
    expect(r.failures.map((f) => f.problem)).toEqual([expect.stringContaining("word-unknown")]);
    expect(judgeExitCode(r)).toBe(2);
  });
});
