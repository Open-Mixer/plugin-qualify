// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The two other sites that name a signal read PROBE_SIGNALS of the probe domain: the sweep reader's exit statuses
 * (measuredPluginsFromSweep: 134, 135, 139) and the crash table (attributeCrash). (a) the words are the golden ones
 * frozen from the hand copy; (c) a temporary domain with the SIGSEGV word changed gives the changed word at both calls.
 * PLUGIN_HOSTD_CONTRACT_DIR names a plugin-hostd checkout's contract.d where the package is not installed.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { initProbeDomain } from "./probe-domain.js";
import { openProbeDomainAt } from "./probe-domain-node.js";
import { measuredPluginsFromSweep } from "./measurement/sweep-jsonl.js";
import { attributeCrash } from "./hosting-suitability.js";

const PROBE_DIR = process.env.PLUGIN_HOSTD_CONTRACT_DIR ?? "/usr/share/omx-contract/contract.d";
const QUICK = {
  uri: "urn:swept",
  instantiated: true,
  rate: 192000,
  block: 512,
  audioInputs: 1,
  audioOutputs: 1,
  cvPorts: 0,
  controlInputs: 3,
  requiredFeatures: ["http://lv2plug.in/ns/ext/urid#map"],
  optionalFeatures: [],
  lifecycle: { cycles: 30, instantiated: 30, failed: 0 },
  threads: { before: 1, afterFirstInstantiate: 1, afterAllFreed: 1, leaked: 0 },
  rtSafety: { interposer: true, blocks: 512, repeats: 3, swept: true, sweepApplicable: true, allocationsInRun: 0, allocationsMin: 0, variable: false, locksInRun: 0, syscallsInRun: 0 },
  exit: 0,
};
const scratch: string[] = [];
afterEach(() => {
  initProbeDomain(undefined);
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

const crashOf = (exit: number) =>
  measuredPluginsFromSweep({ measurements: [{ ...QUICK, crashed: true, exit }] })[0]?.stability?.crashes;
const attribution = (signal: string) => attributeCrash({ signal, topFrame: "pw_memmap_free" });

describe("the sweep reader and the crash table name signals with the probe domain's words", () => {
  it("(a) the words are the golden ones", () => {
    expect(crashOf(134)).toEqual([{ signal: "SIGABRT" }]);
    expect(crashOf(135)).toEqual([{ signal: "SIGBUS" }]);
    expect(crashOf(139)).toEqual([{ signal: "SIGSEGV" }]);
    expect(crashOf(124)).toEqual([]);
    expect(attribution("SIGSEGV")).toBe("host");
    expect(attribution("SIGBUS")).toBe("unknown");
  });

  it("(c) a word changed in the domain is the word both calls use", () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-signal-sites-"));
    scratch.push(dir);
    cpSync(join(PROBE_DIR, "probe"), join(dir, "probe"), { recursive: true });
    const file = join(dir, "probe", "probe.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    for (const w of doc.components.schemas.PROBE_SIGNALS.oneOf) if (w.title === "sigsegv") w.const = "SIGSEGV-x";
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    initProbeDomain(openProbeDomainAt(dir));
    expect(crashOf(139)).toEqual([{ signal: "SIGSEGV-x" }]);
    expect(attribution("SIGSEGV-x")).toBe("host");
    expect(attribution("SIGSEGV")).toBe("unknown");
  });
});
