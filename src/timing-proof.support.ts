// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Tests only. A timing proof reads the load (ruling 2026-11-11): a cost a test measures holds its bounds on a quiet node,
 * and on a node whose 1-minute load average is above the cores it may use the scheduler decides it, not the plugin. So
 * {@link timing} runs a proof's timing comparisons; a miss on a loaded node is written as a TIMING-WARN line naming the
 * miss and the load (the gate reruns the test on a quiet node) and the test goes on; on a quiet node the miss fails,
 * naming the load. Put only timing comparisons in it: what a measurement says about its own shape fails on any node.
 */
import { availableParallelism, loadavg } from "node:os";

/** The node's load, faked for a test of the rule itself. */
export const LOAD_ENV = "PLUGIN_QUALIFY_TEST_LOADAVG";

export interface NodeLoad {
  readonly loadavg1: number;
  readonly cores: number;
}

/** The 1-minute load average (or the fake {@link LOAD_ENV} names) and the cores this process may use. */
export function nodeLoad(env: Readonly<Record<string, string | undefined>> = process.env): NodeLoad {
  const fake = env[LOAD_ENV];
  return { loadavg1: fake !== undefined && fake !== "" ? Number(fake) : loadavg()[0]!, cores: availableParallelism() };
}

const loaded = (l: NodeLoad): boolean => l.loadavg1 > l.cores;
const said = (l: NodeLoad): string => `1-min load ${l.loadavg1.toFixed(2)} on ${String(l.cores)} cores`;

/**
 * Run `proof`, the timing comparisons of the test `name`: "held" when they hold; "warned" when one misses on a loaded
 * node (a TIMING-WARN line on stderr); on a quiet node the miss is rethrown with the load named.
 */
export function timing(name: string, proof: () => void, read: () => NodeLoad = () => nodeLoad()): "held" | "warned" {
  try {
    proof();
    return "held";
  } catch (e) {
    const load = read();
    const message = e instanceof Error ? e.message : String(e);
    if (loaded(load)) {
      process.stderr.write(`TIMING-WARN ${name}: ${message.split("\n")[0] ?? message} (loaded node: ${said(load)})\n`);
      return "warned";
    }
    if (e instanceof Error) {
      e.message = `${message} (quiet node: ${said(load)})`;
      throw e;
    }
    throw new Error(`${message} (quiet node: ${said(load)})`);
  }
}
