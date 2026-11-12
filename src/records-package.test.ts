// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify-records-package`, end to end: a device's qualification directory in, a Debian package out, its
 * members, control and file list read back from the archive itself (and by dpkg-deb where the machine has it). The
 * package's tree, unpacked, is then the distributed layer of a sync, which takes the plugin from it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { FIXTURE_CLAP_ID, writeFakeClap, writeFixtureRecord } from "./distributed-records.support.js";
import { parseSyncArgs, resolveSyncSettings, runSync } from "./qualify-sync.js";
import { readDeb, recordsDependsRange, recordsPackageName } from "./records-package.js";
import { searchPathOf, splitPathFlags } from "./hostd-search-path.support.js";

// the plugin-qualify these records are written by: its minor, up to the next one
const ownVersion = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const [ownMajor = 0, ownMinor = 0] = ownVersion.split(".").map(Number);
const recordsFloor = `${String(ownMajor)}.${String(ownMinor)}.0`;
const recordsCeiling = `${String(ownMajor)}.${String(ownMinor + 1)}`;

describe("the records package's name and dependency", () => {
  it("is named for plugin-db's qualification layer, the class and the set", () => {
    expect(recordsPackageName("rpi5", "zynthian-vangelis")).toBe("plugin-db-qualification-rpi5-zynthian-vangelis");
  });
  it("depends on the minor of the plugin-qualify that wrote it, up to the next minor", () => {
    expect(recordsDependsRange("0.19.3")).toEqual({ floor: "0.19.0", ceiling: "0.20" });
    expect(recordsDependsRange("1.4.0")).toEqual({ floor: "1.4.0", ceiling: "1.5" });
    expect(recordsDependsRange("x")).toBeUndefined();
  });
});

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(PKG, "bin", "plugin-qualify-records-package.mjs");
const scratch = mkdtempSync(join(tmpdir(), "records-package-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args: readonly string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
const dpkgDeb = spawnSync("sh", ["-c", "command -v dpkg-deb"], { encoding: "utf8" }).status === 0;

/** A device's qualification directory: a record with its probe output, one whose probe output is gone, one unmeasured. */
function deviceState(): { state: string; clap: string; kept: string[]; lost: string } {
  const root = join(scratch, "device");
  const clap = join(root, "clap", "plate.clap");
  writeFakeClap(clap);
  const other = join(root, "clap", "other.clap");
  writeFakeClap(other, "other bytes\n");
  const state = join(root, "qualification");
  const good = writeFixtureRecord(state, clap);
  // a second binary under the same id would share the name: the other record goes in a directory of its own first
  const lostDir = join(root, "lost");
  const lost = writeFixtureRecord(lostDir, other);
  writeFileSync(join(state, basename(lost.recordPath)), readFileSync(lost.recordPath));
  writeFileSync(join(state, "Gone-0123456789ab.unmeasured.json"), `${JSON.stringify({ schema: "plugin-qualify.unmeasured-record/1" })}\n`);
  return { state, clap, kept: [basename(good.recordPath), basename(good.probePath)], lost: basename(lost.recordPath) };
}

describe("plugin-qualify-records-package", () => {
  const device = deviceState();
  const out = join(scratch, "out");
  const given = join(scratch, "given.json");
  writeFileSync(given, JSON.stringify({ image: "a test image", packages: { "plugin-qualify": "0.16.1" }, sources: { ui: "0123abc" } }));
  // the fixture's grid holds three cells and the directory names none: --cell says which this set is
  const r = run([device.state, "--host-class", "test-class", "--set", "test-set", "--cell", "48000/128", "--provenance", given, "--version", "2026.10.29", "--out", out]);
  const deb = join(out, "plugin-db-qualification-test-class-test-set-48000-128_2026.10.29_all.deb");
  const dir = "./usr/share/omx/qualification/test-class/test-set-48000-128";

  it("builds the package of the records, named for the class, the set and the version", () => {
    expect(r.stderr).toContain(`${device.lost}: its probe output`);
    expect(r.stderr).toContain("Gone-0123456789ab.unmeasured.json: unmeasured, never applies");
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n").at(-1)).toBe(`${deb}: test-set-48000-128 at 48000/128, 1 records, 3 files`);
    expect(existsSync(deb)).toBe(true);
  });

  it("is a Debian archive with its control and exactly the records, their probe outputs and the provenance", () => {
    const d = readDeb(deb);
    expect(d.members).toEqual(["debian-binary", "control.tar.xz", "data.tar.xz"]);
    expect(d.debianBinary).toBe("2.0\n");
    expect(d.control["Package"]).toBe("plugin-db-qualification-test-class-test-set-48000-128");
    expect(d.control["Version"]).toBe("2026.10.29");
    expect(d.control["Architecture"]).toBe("all");
    expect(d.control["Depends"]).toBe(`plugin-qualify (>= ${recordsFloor}~), plugin-qualify (<< ${recordsCeiling}~)`);
    expect(d.files).toEqual([...device.kept, "provenance.json"].map((f) => `${dir}/${f}`).sort());
    expect(d.controlFiles).toEqual(["./control", "./md5sums"]);
    if (dpkgDeb) {
      const listed = spawnSync("dpkg-deb", ["-c", deb], { encoding: "utf8" }).stdout.split("\n").filter((l) => l.startsWith("-")).map((l) => l.split(/\s+/).at(-1));
      expect(listed.sort()).toEqual(d.files);
      expect(spawnSync("dpkg-deb", ["-f", deb, "Package"], { encoding: "utf8" }).stdout.trim()).toBe("plugin-db-qualification-test-class-test-set-48000-128");
    }
  });

  it("carries the provenance it was given with the set, the class, the package and the date added", () => {
    const tree = join(scratch, "unpacked");
    readDeb(deb, tree);
    const p = JSON.parse(readFileSync(join(tree, dir, "provenance.json"), "utf8"));
    expect(p).toEqual({
      image: "a test image",
      packages: { "plugin-qualify": "0.16.1" },
      sources: { ui: "0123abc" },
      schema: "plugin-qualify.distributed-provenance/1",
      set: "test-set-48000-128",
      hostClass: "test-class",
      cell: { rate: 48000, quantum: 128 },
      package: { name: "plugin-db-qualification-test-class-test-set-48000-128", version: "2026.10.29" },
      date: p.date,
    });
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const f of device.kept) expect(readFileSync(join(tree, dir, f))).toEqual(readFileSync(join(device.state, f)));
  });

  it("unpacked, is a distributed layer the sync takes the plugin from", async () => {
    const tree = join(scratch, "installed");
    readDeb(deb, tree);
    const m = join(scratch, "fresh");
    mkdirSync(join(m, "lv2"), { recursive: true });
    const sp = splitPathFlags([
      "--clap-path", dirname(device.clap), "--lv2-path", join(m, "lv2"), "--lv2-extra", "",
      "--qualification-dir", join(m, "q"), "--descriptor-dir", join(m, "d"), "--state-file", join(m, "s.json"), "--pin-file", join(m, "p.pins"),
      "--hostd-port", "0", "--budget-s", "5", "--host-class", "test-class", "--distributed-dir", join(tree, "usr", "share", "omx", "qualification"),
      "--grid", "48000/128",
    ]);
    const args = parseSyncArgs(sp.argv);
    if (!args.ok) throw new Error(args.error);
    const s = resolveSyncSettings(new Map(), args.args, {}, m, undefined, undefined, sp.run);
    if (!s.ok) throw new Error(s.error);
    // other.clap has no record in the package and is measured; plate.clap is taken from it
    unlinkSync(join(dirname(device.clap), "other.clap"));
    const lines: string[] = [];
    const summary = await runSync(s.settings, { env: {}, log: (l) => lines.push(l) });
    expect(lines).toContain(`distributed: clap:${device.clap}#${FIXTURE_CLAP_ID}: applied (test-set-48000-128)`);
    expect(summary?.distributed).toBe(1);
  });

  it("refuses a name a Debian package cannot carry, and a run without its provenance", () => {
    expect(run([device.state, "--host-class", "Test_Class", "--set", "s", "--provenance", given, "--out", out]).status).toBe(2);
    expect(run([device.state, "--host-class", "c", "--set", "s", "--out", out]).status).toBe(2);
    expect(run([join(scratch, "nothing"), "--host-class", "c", "--set", "s", "--provenance", given, "--out", out]).status).toBe(2);
  });

  it("refuses a lone directory whose records hold several cells and whose name says none", () => {
    const r2 = run([device.state, "--host-class", "c", "--set", "s", "--provenance", given, "--out", join(scratch, "none")]);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("its records are measured at 48000/128, 96000/128; a set is one cell");
    expect(existsSync(join(scratch, "none"))).toBe(false);
  });
});

describe("a run of two cells, one package per cell (#317, plugin-db-qualification#16)", () => {
  /** The fixture's probe output measured at `cell` alone: a run's base measures one rate and one quantum. */
  const onlyAt = (rate: number, quantum: number) => (doc: Record<string, any>): void => {
    doc["grid"] = [{ ...(doc["grid"][0] as Record<string, unknown>), rate, quantum }];
  };
  const root = join(scratch, "run");
  const clap = join(scratch, "run-clap", "plate.clap");
  writeFakeClap(clap);
  writeFixtureRecord(join(root, "b48000-512", "qualification"), clap, onlyAt(48000, 512));
  writeFixtureRecord(join(root, "b96000-256", "qualification"), clap, onlyAt(96000, 256));
  // a record of another cell in the 96000/256 base stays out of its set, named
  const strayDir = join(scratch, "stray");
  const otherClap = join(scratch, "run-clap", "other.clap");
  writeFakeClap(otherClap, "other bytes\n");
  const stray = writeFixtureRecord(strayDir, otherClap, onlyAt(48000, 512));
  for (const f of [stray.recordPath, stray.probePath]) writeFileSync(join(root, "b96000-256", "qualification", basename(f)), readFileSync(f));
  const out = join(scratch, "run-out");
  const given = join(scratch, "run-given.json");
  writeFileSync(given, JSON.stringify({ image: "fedora44 worker" }));
  const r = run([root, "--host-class", "x86-64", "--set", "fedora44", "--provenance", given, "--version", "2026110901", "--out", out]);
  const cells = [
    { set: "fedora44-48000-512", rate: 48000, quantum: 512 },
    { set: "fedora44-96000-256", rate: 96000, quantum: 256 },
  ];
  const debOf = (set: string) => join(out, `plugin-db-qualification-x86-64-${set}_2026110901_all.deb`);

  it("packages both bases of the run root, each as its own set named for its cell, in cell order", () => {
    expect(r.stderr).toContain(`fedora44-96000-256: ${basename(stray.recordPath)}: measured at 48000/512, not at its set's 96000/256; left out`);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual(cells.map((c) => `${debOf(c.set)}: ${c.set} at ${String(c.rate)}/${String(c.quantum)}, 1 records, 3 files`));
    for (const c of cells) {
      const d = readDeb(debOf(c.set));
      expect(d.control["Package"]).toBe(`plugin-db-qualification-x86-64-${c.set}`);
      expect(d.control["Description"]).toContain(`at ${String(c.rate)} Hz, ${String(c.quantum)} frames`);
      const tree = join(scratch, `run-tree-${c.set}`);
      readDeb(debOf(c.set), tree);
      const p = JSON.parse(readFileSync(join(tree, "usr", "share", "omx", "qualification", "x86-64", c.set, "provenance.json"), "utf8"));
      expect(p.set).toBe(c.set);
      expect(p.cell).toEqual({ rate: c.rate, quantum: c.quantum });
    }
  });

  it("takes the same two sets from the bases named one by one", () => {
    const out2 = join(scratch, "run-out-2");
    const r2 = run([join(root, "b96000-256", "qualification"), join(root, "b48000-512", "qualification"), "--host-class", "x86-64", "--set", "fedora44", "--provenance", given, "--version", "2026110901", "--out", out2]);
    expect(r2.status).toBe(0);
    expect(r2.stdout.trim().split("\n").map((l) => l.split(": ")[1]!.split(" at ")[0])).toEqual(cells.map((c) => c.set));
  });

  it("refuses two directories of one cell before writing any package", () => {
    const out3 = join(scratch, "run-out-3");
    const r3 = run([join(root, "b48000-512", "qualification"), root, "--host-class", "x86-64", "--set", "fedora44", "--provenance", given, "--out", out3]);
    expect(r3.status).toBe(2);
    expect(r3.stderr).toContain("are both measured at 48000/512: one set per cell");
    expect(existsSync(out3)).toBe(false);
  });

  it("installed together, a sync at each cell takes its own set", async () => {
    for (const c of cells) {
      const tree = join(scratch, `run-installed-${String(c.rate)}`);
      for (const o of cells) readDeb(debOf(o.set), tree);
      const m = join(scratch, `run-fresh-${String(c.rate)}`);
      mkdirSync(join(m, "lv2"), { recursive: true });
      const sp = splitPathFlags([
        "--clap-path", dirname(clap), "--lv2-path", join(m, "lv2"), "--lv2-extra", "",
        "--qualification-dir", join(m, "q"), "--descriptor-dir", join(m, "d"), "--state-file", join(m, "s.json"), "--pin-file", join(m, "p.pins"),
        "--hostd-port", "0", "--budget-s", "5", "--host-class", "x86-64", "--distributed-dir", join(tree, "usr", "share", "omx", "qualification"),
        "--grid", `${String(c.rate)}/${String(c.quantum)}`,
      ]);
      const args = parseSyncArgs(sp.argv);
      if (!args.ok) throw new Error(args.error);
      const s = resolveSyncSettings(new Map(), args.args, {}, m, undefined, undefined, sp.run);
      if (!s.ok) throw new Error(s.error);
      const lines: string[] = [];
      await runSync(s.settings, { env: {}, log: (l) => lines.push(l) });
      expect(lines).toContain(`distributed: clap:${clap}#${FIXTURE_CLAP_ID}: applied (${c.set})`);
    }
  }, 60_000);
});
