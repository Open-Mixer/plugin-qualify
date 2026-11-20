// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The host class of this machine, the key the store's records are read and written under: a board names itself, else the
 * machine's architecture does, and a machine of no class must name one (plugin-qualify#316).
 */
import { describe, expect, it } from "vitest";

import { hostClassOfBoard, hostClassOfMachine } from "./distributed-records.js";
import { parseSyncArgs, resolveSyncSettings } from "./qualify-sync.js";
import { searchPathOf } from "./hostd-search-path.support.js";

describe("the host class", () => {
  it("is the board's name from the device tree, for the boards it names; none for any other", () => {
    expect(hostClassOfBoard("Raspberry Pi 5 Model B Rev 1.0\0")).toBe("rpi5");
    expect(hostClassOfBoard("Raspberry Pi 4 Model B Rev 1.4")).toBe("rpi4");
    expect(hostClassOfBoard("Raspberry Pi Compute Module 5 Rev 1.0")).toBe("rpi5");
    expect(hostClassOfBoard("Raspberry Pi 400 Rev 1.0")).toBeUndefined();
    expect(hostClassOfBoard("")).toBeUndefined();
    expect(hostClassOfBoard(undefined)).toBeUndefined();
  });

  it("is x86-64 for a machine uname -m calls x86_64, and none for an architecture the layer has no class for (plugin-qualify#316)", () => {
    expect(hostClassOfMachine("x86_64")).toBe("x86-64");
    expect(hostClassOfMachine("x86_64\n")).toBe("x86-64");
    expect(hostClassOfMachine("aarch64")).toBeUndefined();
    expect(hostClassOfMachine("")).toBeUndefined();
    const args = parseSyncArgs([]);
    if (!args.ok) throw new Error("args");
    const noBoard = (machine: string) => resolveSyncSettings(new Map(), args.args, {}, "/home/u", () => undefined, () => machine, searchPathOf([], []));
    const x86 = noBoard("x86_64");
    const arm = noBoard("aarch64");
    if (!x86.ok) throw new Error("settings");
    expect(x86.settings.hostClass).toBe("x86-64");
    expect(arm).toEqual({ ok: false, error: expect.stringContaining("host_class is unset") });
    // a board names itself first: a Pi is rpi5, whatever uname -m says
    const pi = resolveSyncSettings(new Map(), args.args, {}, "/home/u", () => "Raspberry Pi 5 Model B Rev 1.0", () => "aarch64", searchPathOf([], []));
    if (!pi.ok) throw new Error("settings");
    expect(pi.settings.hostClass).toBe("rpi5");
  });

  it("is the setting when one is given, the board's otherwise; a machine of no class must name one", () => {
    const user = parseSyncArgs(["--host-class", "x86-desk"]);
    const sys = parseSyncArgs(["--system"]);
    if (!sys.ok || !user.ok) throw new Error("args");
    const s = resolveSyncSettings(new Map(), sys.args, {}, "/home/u", () => "Raspberry Pi 5 Model B Rev 1.0", undefined, searchPathOf([], []));
    const u = resolveSyncSettings(new Map(), user.args, {}, "/home/u", () => "Raspberry Pi 5 Model B Rev 1.0", undefined, searchPathOf([], []));
    if (!s.ok || !u.ok) throw new Error("settings");
    expect([s.settings.hostClass, s.settings.system, s.settings.distributed]).toEqual(["rpi5", true, true]);
    expect([u.settings.hostClass, u.settings.system]).toEqual(["x86-desk", false]);
    const plain = parseSyncArgs([]);
    if (!plain.ok) throw new Error("args");
    expect(resolveSyncSettings(new Map(), plain.args, {}, "/home/u", () => undefined, () => "riscv64", searchPathOf([], [])).ok).toBe(false);
    const off = parseSyncArgs(["--no-distributed"]);
    expect(off.ok && off.args.noDistributed).toBe(true);
  });
});
