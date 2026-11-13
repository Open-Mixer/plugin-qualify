// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The pin plugin-db holds for an address: `files`, the combined digest of every file a plugin's bytes are
 * (`omx-files/1`, plugin-db's `plugin_db_tables.h`: the SHA-256 of the line `omx-files/1`, then one line
 * `<path>\t<sha256>` per file in byte order of the paths, each ending in one `\n`), and `layout`, the parameter-layout
 * fingerprint plugin-hostd's prober took (`omx-layout/1:<sha256>`), or none. Computed here from the raw per-file
 * digests the prober wrote (`IntegrityMeasurement`): nothing here opens a file or hashes bytes plugin-hostd did not
 * already hash.
 */
import { createHash } from "node:crypto";

import type { IntegrityMeasurement, PinnedFile } from "./measurement/format.js";
import type { LayerPin } from "./judged-layer.js";

/** The scheme name the combined files digest states, plugin-db's `PDB_STORE_FILES_PIN_SCHEME`. */
export const OMX_FILES_SCHEME = "omx-files/1";

/** The combined `omx-files/1` digest of a pin's files, plugin-db's one way to fold several file hashes into one. */
export function omxFilesDigest(files: readonly PinnedFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = [`${OMX_FILES_SCHEME}\n`, ...sorted.map((f) => `${f.path}\t${f.sha256}\n`)].join("");
  return createHash("sha256").update(text).digest("hex");
}

/** The pin plugin-db holds for an integrity measurement, or `undefined` when it took no whole pin (no files). */
export function layerPinOf(integrity: Pick<IntegrityMeasurement, "files" | "layout">): LayerPin | undefined {
  if (integrity.files === undefined || integrity.files.length === 0) return undefined;
  return {
    files: omxFilesDigest(integrity.files),
    layout: integrity.layout === undefined ? null : `${integrity.layout.scheme}:${integrity.layout.sha256}`,
  };
}
