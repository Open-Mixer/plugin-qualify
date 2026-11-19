// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The pin: the key plus an exact match of the per-file SHA-256 set (the store spec's section 3.7, cases C1 to C3).
 * An installed item matches a stored record when the files it holds are exactly the record's list, hashed here, and for
 * a `.clap` its binary's path below the install root; where it is installed, the record's name, its set and the probe
 * columns decide nothing.
 */
import { describe, expect, it } from "vitest";

import { matchStored, pinOfStored } from "./pin-match.js";
import type { StoredResult } from "./qualification-store.js";
import type { FileDigest, SyncItem } from "./qualify-sync.js";

const sha = (c: string): string => c.repeat(64);
const digestOf = (files: Record<string, string>) => (paths: readonly string[]): FileDigest[] | undefined => {
  const out: FileDigest[] = [];
  for (const p of paths) {
    if (files[p] === undefined) return undefined;
    out.push({ path: p, sha256: files[p]!, size: 1, mtimeMs: 1, ino: 1 });
  }
  return out;
};

function result(over: Partial<StoredResult> & { files: { path: string; sha256: string }[]; format: "clap" | "lv2"; uri: string; binary_path: string }): StoredResult {
  return {
    layer: "base", sha256: over.files.find((f) => f.path === over.binary_path)!.sha256, offer: "default", host_class: "x86-64", set: "s1",
    layout_scheme: "omx-layout/1", layout_sha256: sha("9"), tested_version: "1.0", unpinnable: 0, rate: 48000, quantum: 512, outcome: "probe.ok",
    verdicts: [{ host: "omx-clap-host", rating: "suitable", deciding: null, measured: true, qualified: true }],
    ...over,
  } as StoredResult;
}

const clapItem = (root: string): SyncItem => ({ key: `clap:${root}/x.clap`, format: "clap", root, files: ["x.clap"] });
const lv2Item = (files: string[]): SyncItem => ({ key: "lv2:urn:amp", format: "lv2", root: "/b/amp.lv2", files, uri: "urn:amp" });
const CELLS = [{ rate: 48000, quantum: 512 }];

describe("C1: the install root does not decide", () => {
  const r = result({ format: "clap", uri: "org.x.id", binary_path: "x.clap", files: [{ path: "x.clap", sha256: sha("a") }] });
  for (const root of ["/usr/lib/clap", "/usr/lib64/clap", "/usr/local/lib/clap", "/home/u/.clap"]) {
    it(`the same bytes under ${root} take the record`, () => {
      const m = matchStored([r], clapItem(root), "omx-clap-host", digestOf({ "x.clap": sha("a") }), CELLS);
      expect(m.status).toBe("applies");
    });
  }
  it("other bytes under the same name are another build, and are measured", () => {
    expect(matchStored([r], clapItem("/usr/lib/clap"), "omx-clap-host", digestOf({ "x.clap": sha("b") }), CELLS).status).toBe("ignored");
  });
});

describe("C2: one file differs", () => {
  const list = [{ path: "amp.so", sha256: sha("a") }, { path: "amp.ttl", sha256: sha("b") }, { path: "manifest.ttl", sha256: sha("c") }];
  const r = result({ format: "lv2", uri: "urn:amp", binary_path: "amp.so", files: list });
  const files = { "amp.so": sha("a"), "amp.ttl": sha("b"), "manifest.ttl": sha("c") };
  it("the exact set is taken", () => {
    expect(matchStored([r], lv2Item(["manifest.ttl", "amp.ttl", "amp.so"]), "omx-clap-host", digestOf(files), CELLS).status).toBe("applies");
  });
  it("a changed .ttl with the binary of the record is measured", () => {
    expect(matchStored([r], lv2Item(["manifest.ttl", "amp.ttl", "amp.so"]), "omx-clap-host", digestOf({ ...files, "amp.ttl": sha("d") }), CELLS).status).toBe("ignored");
  });
  it("a pin that holds one file MORE than the list is measured", () => {
    expect(matchStored([r], lv2Item(["manifest.ttl", "amp.ttl", "amp.so", "presets.ttl"]), "omx-clap-host", digestOf({ ...files, "presets.ttl": sha("e") }), CELLS).status).toBe("ignored");
  });
  it("a pin that holds one file FEWER (the list names a file the pin lacks) is measured", () => {
    expect(matchStored([r], lv2Item(["manifest.ttl", "amp.so"]), "omx-clap-host", digestOf(files), CELLS).status).toBe("ignored");
  });
});

describe("C3: probe.sha256 decides nothing", () => {
  const r = result({ format: "lv2", uri: "urn:amp", binary_path: "amp.so", files: [{ path: "amp.so", sha256: sha("a") }, { path: "manifest.ttl", sha256: sha("c") }] });
  it("the record is taken with no probe column in the result at all, and the pin is built from the list, the layout and the version", () => {
    const item = lv2Item(["manifest.ttl", "amp.so"]);
    const m = matchStored([r], item, "omx-clap-host", digestOf({ "amp.so": sha("a"), "manifest.ttl": sha("c") }), CELLS);
    expect(m.status).toBe("applies");
    expect(Object.keys(r).filter((k) => /probe/.test(k))).toEqual([]);
    const pin = pinOfStored(item, r, "omx-clap-host");
    expect(pin?.uri).toBe("urn:amp");
    expect(pin?.integrity.files).toEqual([{ path: "amp.so", sha256: sha("a") }, { path: "manifest.ttl", sha256: sha("c") }]);
    expect(pin?.integrity.layout).toEqual({ scheme: "omx-layout/1", sha256: sha("9") });
    expect(pin?.integrity.version).toBe("1.0");
    expect(pin?.verdict).toBe("in-process");
  });
  it("an unpinnable record, or one with no layout, gives no whole pin", () => {
    const item = lv2Item(["manifest.ttl", "amp.so"]);
    expect(pinOfStored(item, { ...r, unpinnable: 1 }, "omx-clap-host")).toBeUndefined();
    expect(pinOfStored(item, { ...r, layout_scheme: null, layout_sha256: null }, "omx-clap-host")).toBeUndefined();
  });
});

describe("the cells and the verdict of the host", () => {
  const r = result({ format: "lv2", uri: "urn:amp", binary_path: "amp.so", files: [{ path: "amp.so", sha256: sha("a") }] });
  const item = lv2Item(["amp.so"]);
  const d = digestOf({ "amp.so": sha("a") });
  it("a record measured at another cell is passed over, naming the cells it holds", () => {
    const m = matchStored([r], item, "omx-clap-host", d, [{ rate: 96000, quantum: 128 }]);
    expect(m.status).toBe("ignored");
    expect((m as { lines: string[] }).lines.join("\n")).toContain("48000/512");
  });
  it("a record with no verdict for the host is passed over", () => {
    expect(matchStored([r], item, "jalv", d, CELLS).status).toBe("ignored");
  });
  it("a verdict the source could not measure is measured here", () => {
    const u = { ...r, verdicts: [{ host: "omx-clap-host", rating: "unknown", deciding: "probe.crashed", measured: false, qualified: false }] };
    expect(matchStored([u as StoredResult], item, "omx-clap-host", d, CELLS).status).toBe("ignored");
  });
  it("no result for the plugin says nothing and is measured", () => {
    expect(matchStored([], item, "omx-clap-host", d, CELLS)).toEqual({ status: "none" });
  });
});
