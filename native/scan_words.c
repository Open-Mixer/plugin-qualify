/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * This file is part of plugin-qualify.
 *
 * Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
 */

#include "scan_words.h"

#include <stdio.h>
#include <string.h>

#define SCOPES_ITEM "SCAN_FIELD_SCOPES"

static int open_domain(const char *dirs, omx_domain **out, char *why, size_t n) {
  omx_domain_error err = { 0 };
  int rc;

  *out = NULL;
  if (dirs == NULL || *dirs == '\0') {
    rc = omx_domain_open(SCAN_DOMAIN, SCAN_FLOOR, out, &err);
  } else {
    const char *p = dirs;

    rc = OMX_CONTRACT_CODE_DIR_ABSENT;
    while (*p != '\0' && rc == OMX_CONTRACT_CODE_DIR_ABSENT) {
      const char *end = strchr(p, ':');
      size_t len = end ? (size_t)(end - p) : strlen(p);
      char dir[4096];

      if (len > 0 && len < sizeof dir) {
        memcpy(dir, p, len);
        dir[len] = '\0';
        rc = omx_domain_open_at(dir, SCAN_DOMAIN, SCAN_FLOOR, out, &err);
      }
      p += len + (end != NULL);
    }
    if (rc == OMX_CONTRACT_CODE_DIR_ABSENT) {
      err.code = omx_domain_code(rc);
      snprintf(err.message, sizeof err.message, "The domain %s is in none of %s.", SCAN_DOMAIN, dirs);
    }
  }
  if (rc != 0) snprintf(why, n, "%s: %s", err.code ? err.code : "contract.file.invalid", err.message);
  return rc;
}

int scan_words_open(const char *dirs, scan_words *w, char *why, size_t n) {
  /* the title the domain gives each scope's word: the key the parser knows the scope by, in enum scan_scope's order */
  static const char *const TITLES[SCAN_SCOPE_COUNT] = {
    "plugin", "param", "audioIn", "audioOut", "noteIn", "noteOut", "port",
    "panel", "section", "control", "role", "display", "placementDefault", "meter",
  };
  int i, count, rc;

  memset(w, 0, sizeof *w);
  if ((rc = open_domain(dirs, &w->domain, why, n)) != 0) return rc;
  if ((count = omx_domain_word_count(w->domain, SCOPES_ITEM)) < 0) {
    snprintf(why, n, "%s: the domain " SCAN_DOMAIN " has no item " SCOPES_ITEM, omx_domain_code(OMX_CONTRACT_CODE_ITEM_UNKNOWN));
    scan_words_close(w);
    return OMX_CONTRACT_CODE_ITEM_UNKNOWN;
  }
  if (count != SCAN_SCOPE_COUNT) {
    snprintf(why, n, "%s: " SCOPES_ITEM " of the domain " SCAN_DOMAIN " has %d words, the parser reads %d",
             omx_domain_code(OMX_CONTRACT_CODE_ITEM_UNKNOWN), count, (int)SCAN_SCOPE_COUNT);
    scan_words_close(w);
    return OMX_CONTRACT_CODE_ITEM_UNKNOWN;
  }
  for (i = 0; i < count; i++) {
    omx_domain_word_info info;
    int s, found = 0;

    if ((rc = omx_domain_word_at(w->domain, SCOPES_ITEM, i, &info)) != 0) {
      snprintf(why, n, "%s: " SCOPES_ITEM " of the domain " SCAN_DOMAIN " has no word at %d", omx_domain_code(rc), i);
      scan_words_close(w);
      return rc;
    }
    for (s = 0; s < SCAN_SCOPE_COUNT && !found; s++)
      if (!strcmp(info.title, TITLES[s])) w->scope[s] = info.word, found = 1;
    if (!found) {
      snprintf(why, n, "%s: " SCOPES_ITEM " of the domain " SCAN_DOMAIN " has a word titled %s, which the parser does not read",
               omx_domain_code(OMX_CONTRACT_CODE_ITEM_UNKNOWN), info.title);
      scan_words_close(w);
      return OMX_CONTRACT_CODE_ITEM_UNKNOWN;
    }
  }
  for (i = 0; i < SCAN_SCOPE_COUNT; i++)
    if (w->scope[i] == NULL) {
      snprintf(why, n, "%s: " SCOPES_ITEM " of the domain " SCAN_DOMAIN " has no word titled %s",
               omx_domain_code(OMX_CONTRACT_CODE_ITEM_UNKNOWN), TITLES[i]);
      scan_words_close(w);
      return OMX_CONTRACT_CODE_ITEM_UNKNOWN;
    }
  return 0;
}

void scan_words_close(scan_words *w) {
  if (w->domain != NULL) omx_domain_close(w->domain);
  memset(w, 0, sizeof *w);
}
