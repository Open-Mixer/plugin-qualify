// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * describe.test.c — the scanned descriptor the format tables (../data/formats, *.json) and the field dump
 * fixtures (fixtures/fields/) build (describe.h). Built by `make -C native`; run with the working directory
 * at native/ (src/describe-native.test.ts does this). Each fixture pair is a field dump the format table maps,
 * and the exact descriptor it must equal; the panel dump proves a scope the table drops (panel, section,
 * control, role, display, placement_default) never leaks into it; describe_panel proves the --json scan's
 * panel object passes through whole, null for a plugin with none, refused for one the scan states no panel for.
 */
#include "describe.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static char *slurp(const char *path) {
  FILE *f = fopen(path, "rb");
  long n;
  char *buf;

  if (!f) { failures++; fprintf(stderr, "FAIL cannot open %s\n", path); return NULL; }
  fseek(f, 0, SEEK_END);
  n = ftell(f);
  fseek(f, 0, SEEK_SET);
  buf = malloc((size_t)n + 1);
  if (fread(buf, 1, (size_t)n, f) != (size_t)n) { failures++; fprintf(stderr, "FAIL short read %s\n", path); }
  buf[n] = '\0';
  fclose(f);
  return buf;
}

/* a descriptor's text, read as JSON and rewritten with no whitespace between tokens: two documents that mean the
 * same compare equal whatever order describe.c wrote their keys and arrays in. Strings and numbers are copied
 * byte for byte, so a key order difference is the only thing this ever forgives. */
static char *canon(const char *json) {
  size_t cap = strlen(json) * 2 + 16, len = 0;
  char *out = malloc(cap);
  size_t i = 0, n = strlen(json);

  while (i < n) {
    char c = json[i];
    if (c == '"') {
      out[len++] = json[i++];
      while (i < n && json[i] != '"') {
        if (json[i] == '\\' && i + 1 < n) { out[len++] = json[i++]; }
        out[len++] = json[i++];
      }
      if (i < n) out[len++] = json[i++];
    } else if (c == ' ' || c == '\n' || c == '\t' || c == '\r') {
      i++;
    } else {
      out[len++] = json[i++];
    }
  }
  out[len] = '\0';
  return out;
}

static void expect_dump(const char *label, const char *table_path, const char *dump_path, const char *target, const char *want_path) {
  char *table = slurp(table_path), *dump = slurp(dump_path), *want_raw = want_path ? slurp(want_path) : NULL;
  sb_t out = { 0 };
  char why[1024] = { 0 };
  int rc;

  if (!table || !dump || (want_path && !want_raw)) return;
  rc = describe_dump(table, dump, target, &out, why, sizeof why);
  if (want_path == NULL) {
    if (rc != 0) { failures++; fprintf(stderr, "FAIL %s: refused: %s\n", label, why); }
  } else if (rc != 0) {
    failures++;
    fprintf(stderr, "FAIL %s: refused: %s\n", label, why);
  } else {
    char *got = canon(out.s ? out.s : "");
    char *want = canon(want_raw);
    if (strcmp(got, want)) { failures++; fprintf(stderr, "FAIL %s: descriptor did not match %s\n", label, want_path); }
    free(got);
    free(want);
  }
  free(table);
  free(dump);
  free(want_raw);
  free(out.s);
}

static void expect_panel(const char *label, const char *scan_path, const char *target, int want_rc, const char *want_contains) {
  char *scan = slurp(scan_path);
  sb_t out = { 0 };
  char why[1024] = { 0 };
  int rc;

  if (!scan) return;
  rc = describe_panel(scan, target, &out, why, sizeof why);
  if (rc != want_rc) {
    failures++;
    fprintf(stderr, "FAIL %s: rc=%d, want %d (%s)\n", label, rc, want_rc, why);
  } else if (want_contains && !strstr(rc == 0 ? (out.s ? out.s : "") : why, want_contains)) {
    failures++;
    fprintf(stderr, "FAIL %s: \"%s\" not in \"%s\"\n", label, want_contains, rc == 0 ? out.s : why);
  }
  free(scan);
  free(out.s);
}

static void format_and_id(void) {
  static const struct { const char *target, *format, *id; } CASES[] = {
    { "clap:controls.clap#org.example.id", "clap", "org.example.id" },
    { "lv2:urn:example:eq", "lv2", "urn:example:eq" },
    { "clap:controls.clap#", NULL, NULL },
    { "clap:#org.example.id", NULL, NULL },
    { "lv2:", NULL, NULL },
    { "vst3:whatever", NULL, NULL },
  };
  size_t i;

  for (i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++) {
    const char *format = describe_format(CASES[i].target);
    const char *id = describe_id(CASES[i].target);

    if ((format == NULL) != (CASES[i].format == NULL) || (format && strcmp(format, CASES[i].format))) {
      failures++;
      fprintf(stderr, "FAIL describe_format(%s) = %s, want %s\n", CASES[i].target, format ? format : "(null)", CASES[i].format ? CASES[i].format : "(null)");
    }
    if ((id == NULL) != (CASES[i].id == NULL) || (id && strcmp(id, CASES[i].id))) {
      failures++;
      fprintf(stderr, "FAIL describe_id(%s) = %s, want %s\n", CASES[i].target, id ? id : "(null)", CASES[i].id ? CASES[i].id : "(null)");
    }
  }
}

/* sabotage: one mapping of the CLAP table changed (CLAP_AUDIO_PORT_IS_MAIN's lookup value, "main" to "side")
   must turn the controls fixture red, proving the fixture compares the table's mapped value and not just its
   shape. A sabotage that stays green means the oracle has no teeth. */
static void sabotage_mapping_changes_descriptor(void) {
  const char *needle = "\"CLAP_AUDIO_PORT_IS_MAIN\": \"main\"";
  const char *replacement = "\"CLAP_AUDIO_PORT_IS_MAIN\": \"side\"";
  char *table = slurp("../data/formats/clap.json");
  char *dump = slurp("fixtures/fields/clap-controls.tsv");
  char *want_raw = slurp("fixtures/fields/clap-controls.json");
  char *hit;

  if (!table || !dump || !want_raw) { free(table); free(dump); free(want_raw); return; }
  hit = strstr(table, needle);
  if (!hit) {
    failures++;
    fprintf(stderr, "FAIL sabotage: %s not found in clap.json\n", needle);
  } else {
    size_t prefix_len = (size_t)(hit - table);
    size_t tail_len = strlen(hit + strlen(needle));
    size_t n = prefix_len + strlen(replacement) + tail_len + 1;
    char *sabotaged = malloc(n);
    sb_t out = { 0 };
    char why[1024] = { 0 };
    int rc;

    memcpy(sabotaged, table, prefix_len);
    memcpy(sabotaged + prefix_len, replacement, strlen(replacement));
    memcpy(sabotaged + prefix_len + strlen(replacement), hit + strlen(needle), tail_len + 1);

    rc = describe_dump(sabotaged, dump, "clap:controls.clap#org.freemixer.plugin-qualify.fixture.controls", &out, why,
                        sizeof why);
    if (rc != 0) {
      /* refused is also a detection: the sabotage did not pass as the fixture unnoticed */
    } else {
      char *got = canon(out.s ? out.s : "");
      char *want = canon(want_raw);
      if (!strcmp(got, want)) {
        failures++;
        fprintf(stderr, "FAIL sabotage: changing CLAP_AUDIO_PORT_IS_MAIN's mapped value left the descriptor unchanged\n");
      }
      free(got);
      free(want);
    }
    free(sabotaged);
    free(out.s);
  }
  free(table);
  free(dump);
  free(want_raw);
}

int main(void) {
  format_and_id();
  sabotage_mapping_changes_descriptor();

  expect_dump("clap fixture controls", "../data/formats/clap.json", "fixtures/fields/clap-controls.tsv",
              "clap:controls.clap#org.freemixer.plugin-qualify.fixture.controls", "fixtures/fields/clap-controls.json");
  expect_dump("lv2 fixture eq", "../data/formats/lv2.json", "fixtures/fields/lv2-eq.tsv", "lv2:urn:example:eq",
              "fixtures/fields/lv2-eq.json");
  expect_dump("lv2 fixture compressor", "../data/formats/lv2.json", "fixtures/fields/lv2-compressor.tsv",
              "lv2:urn:example:compressor", "fixtures/fields/lv2-compressor.json");

  /* the panel scope's fields are dropped (docs/formats.md#what-a-table-drops): appending them to a dump the
     table otherwise maps whole changes nothing in the descriptor they build */
  {
    char *controls = slurp("fixtures/fields/clap-controls.tsv"), *panel = slurp("fixtures/fields/clap-panel.tsv");
    if (controls && panel) {
      size_t n = strlen(controls) + strlen(panel) + 2;
      char *merged = malloc(n);
      char *want = slurp("fixtures/fields/clap-controls.json");

      snprintf(merged, n, "%s\n%s", controls, panel);
      if (want) {
        char *table = slurp("../data/formats/clap.json");
        sb_t out = { 0 };
        char why[1024] = { 0 };
        int rc = describe_dump(table, merged, "clap:controls.clap#org.freemixer.plugin-qualify.fixture.controls", &out, why, sizeof why);

        if (rc != 0) { failures++; fprintf(stderr, "FAIL clap panel fields dropped: refused: %s\n", why); }
        else {
          char *got = canon(out.s ? out.s : "");
          char *wantc = canon(want);
          if (strcmp(got, wantc)) { failures++; fprintf(stderr, "FAIL clap panel fields dropped: the panel scope changed the descriptor\n"); }
          free(got);
          free(wantc);
        }
        free(table);
        free(out.s);
        free(want);
      }
      free(merged);
    }
    free(controls);
    free(panel);
  }

  expect_panel("panel of a plugin that has one", "fixtures/fields/clap-panel-scan.json",
               "clap:controls.clap#org.freemixer.plugin-qualify.fixture.controls", 0, "\"fingerprint\":\"3f2a9c1e\"");
  expect_panel("panel of a plugin that serves none", "fixtures/fields/clap-panel-scan.json", "clap:controls.clap#org.example.bare", 0,
               "\"panel\": null");
  expect_panel("panel of a plugin the scan states no panel for", "fixtures/fields/clap-panel-scan.json",
               "clap:controls.clap#org.example.broken", -1, "the scan states no panel for org.example.broken");

  if (failures) return 1;
  printf("PASS describe\n");
  return 0;
}
