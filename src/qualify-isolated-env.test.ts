// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The isolated step's plugin-hostd searches the directories the sync scanned. It reads LV2_PATH and CLAP_PATH; with
 * neither set it searches only its own defaults, and on a Zynthian every plugin of /zynthian/zynthian-plugins/lv2 was
 * refused at add (-509, -512): 527 refusals of one Raspberry Pi 5 cell, 2026-11-10.
 */
import { afterAll, describe, expect, it } from "vitest";

import { CLAP_RT, device, rejudge, removeDevices } from "./qualify-rejudge.support.js";
import { hostdSearchEnv, isolatedEnv, runSync } from "./qualify-sync.js";

afterAll(removeDevices);

const ALONE = { started: true, added: true, alive: true, workers: 1, instancesInWorker: 1, latencyFrames: 0, cpuPercent: 1, xruns: 0, finite: true, silent: false };

describe("the isolated step's environment", () => {
  it("names every LV2 directory of the settings, lv2_extra's included, and the CLAP ones, in their order", () => {
    const settings = { lv2Dirs: ["/usr/lib/lv2", "/zynthian/zynthian-plugins/lv2"], clapDirs: ["/usr/lib/clap", "/opt/clap"], budgetS: 7 };
    const env = isolatedEnv({ env: { LV2_PATH: "/usr/lib/lv2", KEPT: "1" }, settings } as unknown as Parameters<typeof isolatedEnv>[0]);
    expect(env).toMatchObject({ LV2_PATH: "/usr/lib/lv2:/zynthian/zynthian-plugins/lv2", CLAP_PATH: "/usr/lib/clap:/opt/clap", KEPT: "1" });
    expect(hostdSearchEnv(settings)).toEqual({ LV2_PATH: "/usr/lib/lv2:/zynthian/zynthian-plugins/lv2", CLAP_PATH: "/usr/lib/clap:/opt/clap" });
  });

  it("reaches the runner of an owed step through runSync, whatever the process environment says", async () => {
    const d = device([CLAP_RT]);
    await rejudge(d);
    const settings = { ...d.settings, lv2Dirs: ["/usr/lib/lv2", "/zynthian/zynthian-plugins/lv2"], clapDirs: ["/usr/lib/clap"] };
    const seen: (Readonly<Record<string, string | undefined>> | undefined)[] = [];
    const done = await runSync(settings, {
      isolatedOnly: true,
      isolatedRunner: (_uri, _cell, env) => (seen.push(env), ALONE),
      env: { LV2_PATH: "/somewhere/else" },
      log: () => {},
    });
    expect(done?.isolatedOnly).toEqual({ isolated: 1, refused: 0, notRun: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ LV2_PATH: "/usr/lib/lv2:/zynthian/zynthian-plugins/lv2", CLAP_PATH: "/usr/lib/clap" });
  });
});
