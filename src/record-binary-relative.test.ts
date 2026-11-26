// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A RECORD NAMES ITS BINARY BELOW THE INSTALL ROOT, WHEREVER IT IS WRITTEN (#141). The store refuses a record whose
 * `binary.path` is absolute (plugin-db-qualification's records check, `path-absolute`, its spec's section 3.7), and a set
 * is imported from a `plugin-qualify --out` directory as it is: 0.20.6's CLAP records named `/usr/lib/clap/<x>.clap`
 * and two dry-run sets were refused at import on 2026-11-20. The record `--out` writes is the store's form already:
 * its path is the entry of its file list the key names, and the list is in byte order of the paths.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { readProbeOutput } from "./probe-output.js";
import { fixtureText } from "./probe-output-fixtures.js";
import { storedBinary, storedForm, writeQualification, type QualificationRecord } from "./qualification-record.js";

const scratch = mkdtempSync(join(tmpdir(), "record-binary-relative-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function written(): { probePath: string; record: QualificationRecord; onDisk: QualificationRecord } {
  const text = fixtureText("success-msi");
  const r = readProbeOutput(text);
  if (!r.ok) throw new Error(r.problem);
  const w = writeQualification(mkdtempSync(join(scratch, "out-")), Buffer.from(text), judgeProbeOutput(r.output, [OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE]));
  return { probePath: r.output.binary.path, record: w.record, onDisk: JSON.parse(readFileSync(w.recordPath, "utf8")) as QualificationRecord };
}

describe("a CLAP record's binary.path is relative to the item's install root (#141)", () => {
  it("the probe measured an absolute path — positive control", () => {
    expect(written().probePath).toBe("/usr/lib64/clap/example-plate.clap");
  });

  it("the record --out writes names the file below the root, an entry of its list, with that entry's digest", () => {
    const { onDisk } = written();
    expect(onDisk.binary.path).toBe("example-plate.clap");
    const entry = onDisk.binary.files.find((f) => f.path === onDisk.binary.path);
    expect(entry?.sha256).toBe(onDisk.binary.sha256);
  });

  it("is the store's form already: putting it changes nothing of its binary", () => {
    const { onDisk, record } = written();
    expect(onDisk.binary).toEqual(record.binary);
    expect(storedForm(onDisk).binary).toEqual(onDisk.binary);
    expect(storedBinary(onDisk.binary)).toEqual(onDisk.binary);
  });
});
