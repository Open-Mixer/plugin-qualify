// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The record's `package` object (#123): read from the package manager's owner of `binary.path` when the record is
 * written, null when no package owns the binary. The package managers here are stubs on PATH.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { packageOwnerOf } from "./package-owner.js";
import { OMX_CLAP_HOST_PROFILE } from "./host-profiles.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { readProbeOutput } from "./probe-output.js";
import { fixtureText } from "./probe-output-fixtures.js";
import { writeQualification } from "./qualification-record.js";

const scratch = mkdtempSync(join(tmpdir(), "package-owner-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const realPath = process.env["PATH"];
afterEach(() => {
  process.env["PATH"] = realPath;
});

/** A directory that is the whole PATH, holding the named stub commands, each a shell script. */
function stubs(name: string, scripts: Record<string, string>): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const [cmd, body] of Object.entries(scripts)) {
    const f = join(dir, cmd);
    writeFileSync(f, `#!/bin/sh\n${body}\n`);
    chmodSync(f, 0o755);
  }
  return { dir, env: { PATH: dir } };
}

const BIN = "/usr/lib/clap/dexed.clap";
const DPKG = `case "$1" in
  -S) [ "$2" = ${BIN} ] && { echo "clap-dexed:amd64: ${BIN}"; exit 0; }; echo "dpkg-query: no path found matching pattern $2" >&2; exit 1;;
  -W) for last; do :; done
      case "$last" in
        clap-dexed:amd64) printf 'clap-dexed\\t1.1.0-4\\tamd64\\n';;
        clap-dexed) printf 'clap-dexed\\t1.1.0-4\\tarm64\\nclap-dexed\\t1.1.0-4\\tamd64\\n';;
        *) exit 1;;
      esac
      exit 0;;
esac
exit 2`;
const RPM = `[ "$1" = -qf ] || exit 2
[ "$4" = ${BIN} ] && { printf 'clap-dexed\\t1.1.0\\t4.fc44\\tx86_64\\n'; exit 0; }
echo "file $4 is not owned by any package"; exit 1`;
const osRelease = (text: string): string => {
  const f = join(scratch, `os-release-${Math.abs(text.length)}-${text.slice(-6).replace(/\W/g, "")}`);
  writeFileSync(f, text);
  return f;
};

describe("the package that owns a binary", () => {
  it("is read from dpkg-query: name, version and revision, arch, and the system's codename as distro", () => {
    const { env } = stubs("deb", { "dpkg-query": DPKG });
    expect(packageOwnerOf(BIN, env, osRelease('ID=debian\nVERSION_CODENAME=trixie\n'))).toEqual({
      format: "deb",
      name: "clap-dexed",
      version: "1.1.0",
      release: "4",
      distro: "trixie",
      arch: "amd64",
    });
  });

  it("is read from rpm -qf, the dist tag of the release being the distro", () => {
    const { env } = stubs("rpm", { rpm: RPM });
    expect(packageOwnerOf(BIN, env)).toEqual({ format: "rpm", name: "clap-dexed", version: "1.1.0", release: "4.fc44", distro: "fc44", arch: "x86_64" });
  });

  it("is null when no package owns the binary, and null when there is no package manager", () => {
    const deb = stubs("deb-unowned", { "dpkg-query": DPKG });
    const rpm = stubs("rpm-unowned", { rpm: RPM });
    const none = stubs("none", {});
    expect(packageOwnerOf("/home/u/.clap/mine.clap", deb.env, osRelease("VERSION_CODENAME=trixie\n"))).toBeNull();
    expect(packageOwnerOf("/home/u/.clap/mine.clap", rpm.env)).toBeNull();
    expect(packageOwnerOf(BIN, none.env)).toBeNull();
  });

  it("takes the arch of the owning package's own architecture when the package is installed for several", () => {
    const { env } = stubs("deb-multiarch", { "dpkg-query": DPKG });
    expect(packageOwnerOf(BIN, env, osRelease("VERSION_CODENAME=trixie\n"))?.arch).toBe("amd64");
  });

  it("gives null for a distro or an arch the qualification domain does not hold, the rest still filled", () => {
    const noble = stubs("deb-noble", { "dpkg-query": DPKG });
    expect(packageOwnerOf(BIN, noble.env, osRelease("VERSION_CODENAME=noble\n"))).toMatchObject({ name: "clap-dexed", distro: null, arch: "amd64" });
    const fc46 = stubs("rpm-fc46", { rpm: RPM.replace("4.fc44", "4.fc46") });
    expect(packageOwnerOf(BIN, fc46.env)).toMatchObject({ release: "4.fc46", distro: null, arch: "x86_64" });
    const el9 = stubs("rpm-el9", { rpm: RPM.replace("4.fc44", "4.el9_3") });
    expect(packageOwnerOf(BIN, el9.env)).toMatchObject({ release: "4.el9_3", distro: null });
    const armhf = stubs("rpm-armhf", { rpm: RPM.replace("x86_64", "armv7hl") });
    expect(packageOwnerOf(BIN, armhf.env)).toMatchObject({ distro: "fc44", arch: null });
  });

  it("states no distro it does not know: a Debian system with no codename, an RPM with no dist tag", () => {
    const deb = stubs("deb-nocodename", { "dpkg-query": DPKG });
    expect(packageOwnerOf(BIN, deb.env, osRelease("ID=debian\n"))?.distro).toBeNull();
    const rpm = stubs("rpm-notag", { rpm: RPM.replace("4.fc44", "4") });
    expect(packageOwnerOf(BIN, rpm.env)).toMatchObject({ release: "4", distro: null });
  });
});

describe("the record writes the package at measurement time", () => {
  const judge = (text: string) => {
    const r = readProbeOutput(text);
    if (!r.ok) throw new Error(r.problem);
    return judgeProbeOutput(r.output, [OMX_CLAP_HOST_PROFILE]);
  };

  it("holds the owner of binary.path, and null for a binary no package owns", () => {
    const text = fixtureText("success-msi");
    const judgment = judge(text);
    const path = judgment.output.binary.path;
    const owned = stubs("write-owned", { rpm: RPM.split(BIN).join(path) });
    process.env["PATH"] = owned.dir;
    const a = writeQualification(join(scratch, "w1"), Buffer.from(text), judgment);
    expect(a.record.package).toEqual({ format: "rpm", name: "clap-dexed", version: "1.1.0", release: "4.fc44", distro: "fc44", arch: "x86_64" });
    expect(JSON.parse(readFileSync(a.recordPath, "utf8")).package).toEqual(a.record.package);

    const unowned = stubs("write-unowned", { rpm: RPM });
    process.env["PATH"] = unowned.dir;
    const b = writeQualification(join(scratch, "w2"), Buffer.from(text), judgment);
    expect(b.record.package).toBeNull();
    expect(JSON.parse(readFileSync(b.recordPath, "utf8")).package).toBeNull();
  });

  it("still writes the record when the package's distro is one the domain does not hold", () => {
    const text = fixtureText("success-msi");
    const judgment = judge(text);
    const fc46 = stubs("write-fc46", { rpm: RPM.split(BIN).join(judgment.output.binary.path).replace("4.fc44", "4.fc46") });
    process.env["PATH"] = fc46.dir;
    const w = writeQualification(join(scratch, "w4"), Buffer.from(text), judgment);
    expect(existsSync(w.recordPath)).toBe(true);
    expect(JSON.parse(readFileSync(w.recordPath, "utf8")).package).toMatchObject({ name: "clap-dexed", distro: null, arch: "x86_64" });
  });

  it("writes no crash and a null package when neither dpkg-query nor rpm exists", () => {
    const text = fixtureText("success-msi");
    process.env["PATH"] = stubs("write-none", {}).dir;
    const w = writeQualification(join(scratch, "w3"), Buffer.from(text), judge(text));
    expect(w.record.package).toBeNull();
  });
});

describe("the package object maps onto the store's package columns", () => {
  // spec section 3.5: package.<field> is column record.pkg_<field>; the six columns are nullable (NULL when unowned).
  const columns = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "store-schema", "record-package-columns.sql"), "utf8")
    .split("\n")
    .flatMap((l) => {
      const m = /^\s+pkg_(\w+)\s+TEXT\b(.*)$/.exec(l);
      return m === null ? [] : [{ field: m[1] as string, notNull: /NOT NULL/.test(m[2] as string) }];
    });

  it("has exactly the fields of the store's six pkg_ columns, each nullable", () => {
    const { env } = stubs("map-deb", { "dpkg-query": DPKG });
    const pkg = packageOwnerOf(BIN, env, osRelease("VERSION_CODENAME=trixie\n"));
    expect(pkg).not.toBeNull();
    expect(Object.keys(pkg ?? {}).sort()).toEqual(columns.map((c) => c.field).sort());
    expect(columns.length).toBe(6);
    expect(columns.some((c) => c.notNull)).toBe(false);
  });
});
