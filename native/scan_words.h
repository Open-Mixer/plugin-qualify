/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * This file is part of plugin-qualify.
 *
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 */

#ifndef SCAN_WORDS_H
#define SCAN_WORDS_H

/* The scopes of a field dump, which omx-clap-core's scan domain (contract.d/scan/scan.json there, shipped by
 * omx-clap-core-contract) holds as the words of SCAN_FIELD_SCOPES: the first field of a dump line, `param:3`, `plugin`.
 * The parser of describe.c knows what each scope is under a title the domain gives its word; the word is the domain's, read
 * once, so no scope name is a literal of the parser. */

#include <omxcontract/omx_domain.h>
#include <stddef.h>

#define SCAN_DOMAIN "scan"
/* the lowest info.version of the scan domain this package reads */
#define SCAN_FLOOR "1.0.0"

/* the scopes the parser knows, by the title the domain gives their word */
enum scan_scope {
  SCAN_SCOPE_PLUGIN,
  SCAN_SCOPE_PARAM,
  SCAN_SCOPE_AUDIO_IN,
  SCAN_SCOPE_AUDIO_OUT,
  SCAN_SCOPE_NOTE_IN,
  SCAN_SCOPE_NOTE_OUT,
  SCAN_SCOPE_PORT,
  SCAN_SCOPE_PANEL,
  SCAN_SCOPE_SECTION,
  SCAN_SCOPE_CONTROL,
  SCAN_SCOPE_ROLE,
  SCAN_SCOPE_DISPLAY,
  SCAN_SCOPE_PLACEMENT_DEFAULT,
  SCAN_SCOPE_METER,
  SCAN_SCOPE_COUNT
};

/* the scope words, read from the scan domain; they point into the open handle, which lives until scan_words_close() */
typedef struct {
  omx_domain *domain;
  const char *scope[SCAN_SCOPE_COUNT];
} scan_words;

/* Open the scan domain and take the scope words. dirs is NULL for the installed contract directory, else a ':' list whose
 * first directory holding the domain wins (a test's entry). 0, or the OMX_CONTRACT_CODE_* value of the refusal, with why
 * naming the domain, the loader's code and the item. */
int scan_words_open(const char *dirs, scan_words *w, char *why, size_t n);

/* Release the handle, and with it the words; closing twice is harmless. */
void scan_words_close(scan_words *w);

#endif
