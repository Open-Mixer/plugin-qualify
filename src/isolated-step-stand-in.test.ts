// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * tools/isolated-step.mjs against a stand-in plugin-hostd that, like the real one, refuses a plugin outside the LV2_PATH
 * it was started with and says why on stderr only. Run through spawnedIsolatedRunner with the environment the sync
 * builds, so the directories the sync scanned reach the daemon, and a refusal that does happen carries the daemon's own
 * reason into the step's detail rather than its bare number.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ISOLATED_CODE, ISOLATED_RESULT, judgeIsolatedRun, spawnedIsolatedRunner } from "./qualify-isolated.js";
import { ISOLATED_SIGNAL_TOOL_ENV } from "./qualify-declarations.js";
import { isolatedEnv } from "./qualify-sync.js";

const dir = mkdtempSync(join(tmpdir(), "isolated-step-stand-in-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const REASON = "manifest.ttl is in no bundle of lv2_path naming the plugin";
const hostd = join(dir, "plugin-hostd");
writeFileSync(
  hostd,
  `#!${process.execPath}
const net = require("node:net");
const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
const seen = (process.env.LV2_PATH || "").split(":").includes(process.env.STAND_BUNDLES);
net.createServer((c) => c.on("data", (d) => {
  const [cmd, uri] = d.toString().replace(/\\0$/, "").split(" ");
  if (cmd === "add") {
    process.stderr.write("plugin-hostd: " + uri + ": no pin\\n");
    if (!seen) { process.stderr.write("plugin-hostd: " + uri + ": ${REASON}\\n"); return c.write("resp -509\\0"); }
    return c.write("resp 0\\0");
  }
  if (cmd === "worker_list") return c.write("resp 1 w1:" + process.pid + ":lv2-clap:up:-:qualified:own:0\\0");
  c.write("resp 0\\0");
})).listen(port, "127.0.0.1");
`,
);
chmodSync(hostd, 0o755);
const signal = join(dir, "isolated_signal");
writeFileSync(signal, `#!/bin/sh\necho '{"latencyFrames":0,"xruns":0,"finite":true,"silent":false,"midiInputsLinked":0}'\n`);
chmodSync(signal, 0o755);

const BUNDLES = "/zynthian/zynthian-plugins/lv2";
const URI = "https://hannesbraun.net/ns/lv2/airwindows/bassdrive";
const CELL = { rate: 48000, quantum: 64 };
const noJack = () => ({ name: "stand-in", alive: () => true, stop: () => {} });
const runner = spawnedIsolatedRunner(noJack as unknown as Parameters<typeof spawnedIsolatedRunner>[0]);
const sync = (lv2Dirs: string[]) =>
  isolatedEnv({
    env: { ...process.env, PLUGIN_HOSTD: hostd, STAND_BUNDLES: BUNDLES, [ISOLATED_SIGNAL_TOOL_ENV]: signal, LV2_PATH: undefined },
    settings: { lv2Dirs, clapDirs: ["/usr/lib/clap"], budgetS: 5 },
  } as unknown as Parameters<typeof isolatedEnv>[0]);

describe("the isolated step under a stand-in plugin-hostd", () => {
  it("adds a plugin of lv2_extra: the sync's directories reach the daemon", () => {
    const step = judgeIsolatedRun(runner(URI, CELL, sync(["/usr/lib/lv2", BUNDLES])));
    expect(step.result).toBe(ISOLATED_RESULT.isolated);
  });

  it("a refused add carries the daemon's reason, not its number alone", () => {
    const step = judgeIsolatedRun(runner(URI, CELL, sync(["/usr/lib/lv2"])));
    expect(step).toMatchObject({ result: ISOLATED_RESULT.refused, code: ISOLATED_CODE.notAdded, detail: `add answered -509: ${REASON}` });
  });
});
