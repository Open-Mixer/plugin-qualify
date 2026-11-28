// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The package reads the outcome and signal words of the probe domain (plugin-hostd's contract.d/probe/probe.json, shipped
 * by plugin-hostd-protocol-contract) at run time: the words the judging code compares a probe's output with are the domain's, a word
 * changed there is the word the consumer reads, and a domain that is absent is refused by name. (a) the consumers' words
 * are the golden ones frozen from the literals they held; (b) they are the installed domain's own words; (c) a temporary
 * domain with a word changed gives the changed word at the call, and one that is absent is refused. The calls are the
 * consumers' real ones: isOutOfMemory, outOfMemory and outcomeOfVerdict.
 *
 * The probe domain is read where plugin-hostd-protocol-contract installs it; PLUGIN_HOSTD_PROTOCOL_CONTRACT_DIR names a checkout's
 * contract.d instead, for a machine that has the package nowhere.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

const CONTRACT_DIR = INSTALLED_CONTRACT_DIR;
const PROBE_DIR = process.env.PLUGIN_HOSTD_PROTOCOL_CONTRACT_DIR ?? "/usr/share/omx-contract/contract.d";

/** The golden words, frozen from the literals of the consumers at 2d6aefc: the title of the word in the domain and the word. */
const GOLDEN_OUTCOMES = {
  probeOk: "probe.ok",
  probeCrashed: "probe.crashed",
  probeTimeout: "probe.timeout",
  probeMemoryLimit: "probe.memory-limit",
  probeRefusedInstantiation: "probe.refused-instantiation",
  probeNonFiniteOutput: "probe.non-finite-output",
  probeNotAttempted: "probe.not-attempted",
} as const;
const GOLDEN_SIGKILL = "SIGKILL";

const scratch: string[] = [];
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./qualification-installed-dir.js");
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A contract directory of this checkout's qualification domain and the probe domain, `edit` applied to the probe document. */
function contractDir(edit?: (doc: { components: { schemas: Record<string, { oneOf: { const: string; title: string }[] }> } }) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "probe-domain-read-"));
  scratch.push(dir);
  cpSync(join(CONTRACT_DIR, "qualification"), join(dir, "qualification"), { recursive: true });
  if (edit !== undefined) {
    cpSync(join(PROBE_DIR, "probe"), join(dir, "probe"), { recursive: true });
    const file = join(dir, "probe", "probe.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    edit(doc);
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return dir;
}

/** The consumers over the installed place `dir`: a fresh module graph, as a program that starts there reads. */
async function consumersOver(dir: string) {
  vi.resetModules();
  vi.doMock("./qualification-installed-dir.js", () => ({ INSTALLED_CONTRACT_DIR: dir }));
  await import("./qualification-domain-node.js");
  await import("./probe-domain-node.js");
  const memory = await import("./memory-bound.js");
  const distributed = await import("./distributed-records.js");
  return { memory, distributed };
}

const stepOf = (outcome: string, signal?: string) => ({ step: "lifecycle", outcome, ...(signal === undefined ? {} : { signal }) });
const outputOf = (runOutcome: string, steps: unknown[]) => ({ run: { outcome: runOutcome }, steps }) as never;

describe("the consumers compare a probe's output with the probe domain's words", () => {
  it("(a) the words are the golden ones", async () => {
    const { memory, distributed } = await consumersOver(assembled());
    expect(memory.isOutOfMemory(GOLDEN_OUTCOMES.probeMemoryLimit)).toBe(true);
    expect(memory.isOutOfMemory(GOLDEN_OUTCOMES.probeOk)).toBe(false);
    expect(memory.outOfMemory(outputOf(GOLDEN_OUTCOMES.probeMemoryLimit, []), undefined)).toBe(true);
    const bound = memory.memoryBoundOf(2 ** 31);
    expect(memory.outOfMemory(outputOf(GOLDEN_OUTCOMES.probeCrashed, [stepOf(GOLDEN_OUTCOMES.probeCrashed, GOLDEN_SIGKILL)]), bound)).toBe(true);
    expect(memory.outOfMemory(outputOf(GOLDEN_OUTCOMES.probeCrashed, [stepOf(GOLDEN_OUTCOMES.probeCrashed, "SIGSEGV")]), bound)).toBe(false);
    expect(distributed.outcomeOfVerdict({ measured: false, rating: undefined, deciding: GOLDEN_OUTCOMES.probeCrashed } as never)).toBe("crashed");
    expect(distributed.outcomeOfVerdict({ measured: false, rating: undefined, deciding: GOLDEN_OUTCOMES.probeTimeout } as never)).toBe("hung");
    expect(distributed.outcomeOfVerdict({ measured: false, rating: undefined, deciding: GOLDEN_OUTCOMES.probeOk } as never)).toBe("unmeasured");
  });

  it("(b) the golden words are the installed domain's own", async () => {
    const { openDomainAt } = await import("@openmixer/omx-contract/domain-reader");
    const domain = openDomainAt(PROBE_DIR, "probe", "0.1.0");
    for (const [title, word] of Object.entries(GOLDEN_OUTCOMES)) {
      expect(domain.words("PROBE_OUTCOMES").find((w) => w.title === title)?.word, title).toBe(word);
    }
    expect(domain.words("PROBE_SIGNALS").find((w) => w.title === "sigkill")?.word).toBe(GOLDEN_SIGKILL);
  });

  it("(c) a word changed in the domain is the word the consumer reads", async () => {
    const dir = contractDir((d) => {
      for (const w of d.components.schemas.PROBE_OUTCOMES!.oneOf) if (w.title === "probeMemoryLimit") w.const = "probe.memory-limit-x";
    });
    const { memory } = await consumersOver(dir);
    expect(memory.isOutOfMemory("probe.memory-limit-x")).toBe(true);
    expect(memory.isOutOfMemory("probe.memory-limit")).toBe(false);
  });

  it("(c) a probe domain that is absent is refused by name", async () => {
    const dir = contractDir();
    const { memory } = await consumersOver(dir);
    expect(() => memory.isOutOfMemory("probe.memory-limit")).toThrow(/probe/);
  });
});

/** The checkout's qualification domain and the installed probe domain in one directory, the place the tests read. */
function assembled(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe-domain-read-"));
  scratch.push(dir);
  cpSync(join(CONTRACT_DIR, "qualification"), join(dir, "qualification"), { recursive: true });
  if (existsSync(join(PROBE_DIR, "probe"))) cpSync(join(PROBE_DIR, "probe"), join(dir, "probe"), { recursive: true });
  return dir;
}
