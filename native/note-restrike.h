/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com> */
/*
 * An instrument's held notes are struck again as its cost is timed (#26), the one rule both measurers time by (the
 * cost pass of lv2-measure.c, beside NOTE_SETTLE_S, and clap-qualify.c's). Struck once, before a 64-block warm-up, a
 * decaying patch (a pluck, a piano let ring, a drum) has no voice left when the timed blocks begin, and its voice curve
 * reads the idle cost at every count. Every NOTE_RESTRIKE_S of the run each held key is let go and struck again, in the
 * same block, so the plugin is timed playing the notes the count names. A sustaining patch holds as before: its voice is
 * released and taken again at once.
 */
#ifndef OMX_NATIVE_NOTE_RESTRIKE_H
#define OMX_NATIVE_NOTE_RESTRIKE_H

#include <stdint.h>

/* how often the held notes are struck again, in seconds of the run: shorter than any patch the console would call
 * decaying, long enough that the attack is a small part of the timed blocks */
#define NOTE_RESTRIKE_S 0.05

/* whether block b (0 the first) strikes the held notes again: never the first, which strikes them once; then every
 * NOTE_RESTRIKE_S, at least every block */
static inline int note_restrike_due(uint32_t b, double rate, uint32_t block) {
  if (b == 0 || block == 0) return 0;
  uint32_t every = (uint32_t)(rate * NOTE_RESTRIKE_S / (double)block);
  if (every == 0) every = 1;
  return b % every == 0;
}

#endif
