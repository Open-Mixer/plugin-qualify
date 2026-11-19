// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualification domain belongs to plugin-hostd (plugin-hostd-contract >= 0.20.8 ships it in the contract directory).
 * plugin-qualify only sets values: it carries no domain document, ships no contract package, and reads the installed one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";
import { openInstalledQualificationDomain } from "./qualification-domain-node.js";
import { TEST_CONTRACT_DIR } from "./test-contract-dir.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");

describe("the qualification domain is plugin-hostd's", () => {
  it("plugin-qualify tracks no qualification domain file", () => {
    const tracked = execFileSync("git", ["-C", PKG, "ls-files", "contract.d"], { encoding: "utf8" }).trim();
    expect(tracked).toBe("");
    expect(existsSync(join(PKG, "contract.d", "qualification"))).toBe(false);
  });

  it("the installed reader reads the installed contract directory, the one plugin-hostd-contract fills", async () => {
    const real = await vi.importActual<{ INSTALLED_CONTRACT_DIR: string }>("./qualification-installed-dir.js");
    expect(real.INSTALLED_CONTRACT_DIR).toBe("/usr/share/omx-contract/contract.d");
    expect(INSTALLED_CONTRACT_DIR).toBe(TEST_CONTRACT_DIR);
    expect(existsSync(join(TEST_CONTRACT_DIR, "qualification", "qualification.json"))).toBe(true);
    expect(openInstalledQualificationDomain()).toBeDefined();
  });

  it("no package of plugin-qualify ships the domain, and each requires plugin-hostd-contract at the floor", () => {
    const spec = read("packaging/plugin-qualify.spec");
    expect(spec).not.toMatch(/^%package contract$/m);
    expect(spec).not.toMatch(/omx_contract_domain_dir|--domain contract\.d/);
    expect(spec).toMatch(/^BuildRequires: plugin-hostd-contract >= 0\.20\.8$/m);
    expect(spec).toMatch(/^Requires: plugin-hostd-contract >= 0\.20\.8$/m);
    expect(spec).not.toMatch(/^(Breaks|Replaces|Conflicts|Obsoletes):.*plugin-qualify-contract/m);
    const control = read("debian/control");
    expect(control).not.toMatch(/^Package: plugin-qualify-contract$/m);
    expect(control).toMatch(/Build-Depends:[^]*plugin-hostd-contract \(>= 0\.20\.8~\)/);
    expect(control).toMatch(/^Depends: .*plugin-hostd-contract \(>= 0\.20\.8~\)/m);
    expect(control).not.toMatch(/^(Breaks|Replaces|Conflicts): .*plugin-qualify-contract/m);
    expect(existsSync(join(PKG, "debian/plugin-qualify-contract.install"))).toBe(false);
    expect(read("debian/rules")).not.toMatch(/--domain contract\.d/);
  });
});
