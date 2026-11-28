// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The pins a sync's state holds, for a test to read. The sync writes no pin file and sends plugin-hostd nothing: the
 * daemon reads every pin and verdict from the qualification store (plugin-hostd's spec of 2026-11-28, pins from the
 * store). What a run judged is still in its state, each plugin's pin with the words the run gave it, and these read it
 * as the lines the pin file held, so a test asserts what the run decided without a file that no longer exists.
 */
import { readSyncState } from "./qualify-sync.js";
import { parsePinLine, pinsFile, type ParsedPin } from "./pins-file.js";

/** The state's pins as pin lines, sorted by uri, the worse verdict kept for a uri pinned twice. */
export function statePinsText(stateFile: string): string {
  const state = readSyncState(stateFile);
  const entries = Object.values(state.entries).flatMap((e) => e.plugins.flatMap((p) => (p.pin === undefined ? [] : [p.pin])));
  return pinsFile(entries, "plugin-qualify-sync").text;
}

/** The state's pins, each read back with plugin-hostd's grammar. */
export function statePins(stateFile: string): ParsedPin[] {
  return statePinsText(stateFile)
    .split("\n")
    .map((l) => parsePinLine(l))
    .filter((p): p is ParsedPin => p !== undefined);
}
