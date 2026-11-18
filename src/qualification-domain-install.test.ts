// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualification domain (contract.d/qualification/) ships in the plugin-qualify-contract subpackage (noarch data in
 * the rpm, an Architecture: all binary package in the deb), never in the main package, and is installed by ONE
 * implementation: omx-contract's installer in its domain mode (`install-contract-dir.sh --domain`, called from the spec's %install and debian/rules). The installed tree opens with
 * the reader, and the tree is in omx-contract's one formatting. Needs omx-contract (pkg-config omx-contract) with the
 * installer's domain mode and `omx-contract fmt` (3.20.0).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openQualificationDomainAt } from "./qualification-domain-node.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");
const pc = (variable: string) => execFileSync("pkg-config", [`--variable=${variable}`, "omx-contract"], { encoding: "utf8" }).trim();

/** Every file under `dir`, relative, sorted. */
function files(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(dir, join(rel, e.name)) : [join(rel, e.name)]))
    .sort();
}

/** A package stanza of a debian/control (or the spec's %package) by its first line. */
function stanza(text: string, first: string): string {
  const i = text.split("\n\n").findIndex((s) => s.startsWith(first));
  return i < 0 ? "" : text.split("\n\n")[i];
}

describe("the qualification domain's installation", () => {
  let dest = "";
  let contractdir = "";
  beforeAll(() => {
    dest = mkdtempSync(join(tmpdir(), "pq-contract-"));
    contractdir = pc("contractdir");
    // the one-line call the spec and debian/rules make, into a temporary root
    execFileSync("sh", [join(pc("datadir"), "install-contract-dir.sh"), "--domain", "contract.d/qualification", join(dest, contractdir)], { cwd: PKG, stdio: "pipe" });
  });
  afterAll(() => rmSync(dest, { recursive: true, force: true }));

  it("the installer's domain mode puts the document and its catalogs, byte for byte, in the contract directory and nowhere else", () => {
    const want = files(join(PKG, "contract.d", "qualification"));
    expect(want).toContain("qualification.json");
    expect(want.filter((f) => f.startsWith("catalogs/")).length).toBeGreaterThan(0);
    const got = files(join(dest, contractdir, "qualification"));
    expect(got).toEqual(want);
    for (const f of want) {
      expect(readFileSync(join(dest, contractdir, "qualification", f)).equals(readFileSync(join(PKG, "contract.d", "qualification", f)))).toBe(true);
    }
    // the domain is the only thing installed, and by the installer: no copy under the package's own directories
    expect(files(dest).every((f) => f.startsWith(join(contractdir, "qualification").slice(1) + "/"))).toBe(true);
  });

  it("the installed tree opens with the reader", () => {
    const d = openQualificationDomainAt(join(dest, contractdir));
    expect(d).toBeDefined();
  });

  it("the spec and debian/rules each call the installer's domain mode and type no install line for the domain", () => {
    const spec = read("packaging/plugin-qualify.spec");
    const install = spec.slice(spec.indexOf("\n%install\n"), spec.indexOf("\n%post\n"));
    const call = /install-contract-dir\.sh" --domain contract\.d\/qualification \\\n\s*"[^\n]*--variable=contractdir omx-contract\)"/;
    expect(install).toMatch(call);
    expect(install).toContain("%{buildroot}");
    const rules = read("debian/rules");
    expect(rules).toMatch(call);
    expect(rules).toMatch(/--domain contract\.d\/qualification \\\n\s*"[^\n]*debian\/tmp/);
    for (const t of [install, rules]) expect(t).not.toMatch(/^\s*install .*contract\.d\/qualification/m);
  });
});

describe("the qualification domain's packages", () => {
  it("the rpm has a noarch %package contract whose %files is the domain directory, and the main package lists none of it", () => {
    const spec = read("packaging/plugin-qualify.spec");
    const pkg = /^%package contract\n([\s\S]*?)\n\n/m.exec(spec)?.[1] ?? "";
    expect(pkg).toMatch(/^Summary: .+$/m);
    expect(pkg).toMatch(/^BuildArch: noarch$/m);
    expect(spec).toMatch(/^%description contract$/m);
    expect(spec).toMatch(/^%files contract\n%\{omx_contract_domain_dir\}\/qualification\/$/m);
    const main = spec.slice(spec.indexOf("\n%files\n"), spec.indexOf("\n%package "));
    expect(main).not.toMatch(/omx-contract/);
    expect(main).not.toMatch(/omx_contract/);
    expect(spec).toMatch(/^Requires: plugin-qualify-contract = %\{version\}-%\{release\}$/m);
    expect(spec).not.toMatch(/^install .*contract\.d\/qualification/m);
  });
  it("the deb has Package: plugin-qualify-contract (Architecture: all) with its .install, and the main package installs none of it", () => {
    const control = read("debian/control");
    const pkg = stanza(control, "Package: plugin-qualify-contract");
    expect(pkg).toMatch(/^Architecture: all$/m);
    expect(pkg).toMatch(/^Description: .+/m);
    expect(read("debian/plugin-qualify-contract.install").trim()).toBe("usr/share/omx-contract/contract.d/qualification");
    expect(stanza(control, "Package: plugin-qualify\n")).toMatch(/^Depends: .*plugin-qualify-contract \(= \$\{source:Version\}\)/m);
    const rules = read("debian/rules");
    expect(rules).not.toMatch(/install .*contract\.d\/qualification/);
    expect(existsMainInstall()).toBe(false);
  });
});

function existsMainInstall(): boolean {
  try {
    return /omx-contract/.test(read("debian/plugin-qualify.install"));
  } catch {
    return false;
  }
}

describe("the qualification document's formatting", () => {
  it("omx-contract fmt --check --contract-dir contract.d passes", () => {
    // the installed command (npx puts an older one first on PATH)
    execFileSync(join(pc("prefix"), "bin", "omx-contract"), ["fmt", "--check", "--contract-dir", "contract.d"], { cwd: PKG, stdio: "pipe" });
  });
});
