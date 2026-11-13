// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { layerPinOf, omxFilesDigest, OMX_FILES_SCHEME } from "./plugin-db-pin.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("omxFilesDigest", () => {
  it("is the SHA-256 of the scheme line then one line per file, sorted by path", () => {
    const a = sha(`a.clap`);
    const b = sha(`manifest.ttl`);
    const digest = omxFilesDigest([
      { path: "manifest.ttl", sha256: b },
      { path: "a.clap", sha256: a },
    ]);
    const expected = sha(`${OMX_FILES_SCHEME}\na.clap\t${a}\nmanifest.ttl\t${b}\n`);
    expect(digest).toBe(expected);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the order files are given in makes no difference: the digest sorts them", () => {
    const files = [
      { path: "z.ttl", sha256: sha("z") },
      { path: "a.ttl", sha256: sha("a") },
    ];
    expect(omxFilesDigest(files)).toBe(omxFilesDigest([...files].reverse()));
  });

  it("one changed byte in one file changes the digest", () => {
    const files = [{ path: "x.clap", sha256: sha("x") }];
    const changed = [{ path: "x.clap", sha256: sha("x-changed") }];
    expect(omxFilesDigest(files)).not.toBe(omxFilesDigest(changed));
  });
});

describe("layerPinOf", () => {
  it("folds the files into one digest, and the layout into <scheme>:<sha256>", () => {
    const sha256 = sha("x");
    const layoutSha = sha("layout");
    const pin = layerPinOf({ files: [{ path: "x.clap", sha256 }], layout: { scheme: "omx-layout/1", sha256: layoutSha } });
    expect(pin).toEqual({ files: omxFilesDigest([{ path: "x.clap", sha256 }]), layout: `omx-layout/1:${layoutSha}` });
  });

  it("no layout is null, never omitted", () => {
    const pin = layerPinOf({ files: [{ path: "x.clap", sha256: sha("x") }] });
    expect(pin?.layout).toBeNull();
  });

  it("no files is no pin: a run that took no whole pin pins nothing", () => {
    expect(layerPinOf({})).toBeUndefined();
    expect(layerPinOf({ files: [] })).toBeUndefined();
  });
});
