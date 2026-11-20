// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * describe's oracle reads the scan domain (omx-clap-core's) through omx-contract's C loader. It is built and run where the
 * channel serves that loader, the Fedora 45 container job of ci.yml (the channel's bookworm repository has no
 * libomx-domain, and the ubuntu runner takes no trixie package): that job installs libomx-domain-devel and
 * omx-clap-core-contract at their floors, a floor only (no Breaks, Replaces, Conflicts or Provides), and checks the floor
 * on what dnf installed. The ordinary build and test job leaves the oracle and its two tests out.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string): string => readFileSync(join(ROOT, f), "utf8");
const CI = read(".github/workflows/ci.yml");
const JOB = CI.slice(CI.indexOf("\n  container-tests:"), CI.indexOf("\n  catalogs:"));

describe("the oracle is built where the channel serves the loader, at the floors of the scan domain", () => {
  it("the container job installs the loader and omx-clap-core's package of the domain", () => {
    expect(JOB).toContain("image: fedora:45");
    expect(JOB).toContain("'libomx-domain-devel >= 3.20.0'");
    expect(JOB).toContain("'omx-clap-core-contract >= 0.33.1'");
  });
  it("it builds the oracle, and checks the floor on what dnf installed", () => {
    expect(JOB).toContain("make -C native describe-oracle");
    expect(JOB).toMatch(/rpm -q --qf '%\{VERSION\}' omx-clap-core-contract/);
    expect(JOB).toContain("0.33.1");
  });
  it("the two tests that run the oracle are the container job's, not the ordinary run's", () => {
    const list = read(".github/container-tests.txt");
    expect(list).toContain("src/describe-scan-scopes.test.ts");
    expect(list).toContain("src/describe-native.test.ts");
  });
  it("the ordinary build installs nothing from the channel for it, and builds no oracle", () => {
    expect(read(".github/actions/build-native/action.yml")).not.toContain("libomx-domain");
    expect(read("native/Makefile")).not.toMatch(/^all:[^\n]*describe_test/m);
  });
  it("it is a floor only: no relation of another kind names either", () => {
    for (const text of [read("packaging/plugin-qualify.spec"), read("debian/control")]) {
      expect(text).not.toMatch(/(Breaks|Replaces|Conflicts|Provides):[^\n]*(omx-clap-core-contract|libomx-domain)/);
    }
  });
});
