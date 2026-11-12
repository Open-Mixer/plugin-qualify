// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * Two fixtures shaped like the EQ10Q family (plugin-qualify#27): a mono pass-through with ports
 * its own TTL misdeclares, so the scanner's descriptor mapping is exercised on the real shapes
 * found in the field, not an invented one.
 *
 *   eq10qm   a toggle port named "bypass", with no formal lv2:designation: the descriptor must
 *            read the meaning from the symbol, as the console's header does.
 *   eq10qs   two output control ports the TTL both names "out_2_vu_ctl": two ports no caller can
 *            address by symbol, which the descriptor must refuse rather than carry silently.
 */
#include <stdlib.h>
#include <string.h>

#include <lv2/core/lv2.h>

#define URI_PREFIX "urn:plugin-qualify:fixture:lv2-"

enum kind { EQ10QM, EQ10QS, KINDS };

struct eq10q {
  enum kind kind;
  const float *in;
  float *out;
  const float *bypass;
  float *vu_a;
  float *vu_b;
};

enum { QM_BYPASS, QM_IN, QM_OUT };
enum { QS_IN, QS_OUT, QS_VU_A, QS_VU_B };

static LV2_Handle make(enum kind kind) {
  struct eq10q *e = calloc(1, sizeof *e);
  if (e) e->kind = kind;
  return e;
}

static LV2_Handle instantiate_qm(const LV2_Descriptor *d, double rate, const char *p, const LV2_Feature *const *f) {
  (void)d; (void)rate; (void)p; (void)f;
  return make(EQ10QM);
}

static LV2_Handle instantiate_qs(const LV2_Descriptor *d, double rate, const char *p, const LV2_Feature *const *f) {
  (void)d; (void)rate; (void)p; (void)f;
  return make(EQ10QS);
}

static void connect_port(LV2_Handle h, uint32_t port, void *data) {
  struct eq10q *e = h;
  if (e->kind == EQ10QM) {
    switch (port) {
    case QM_BYPASS: e->bypass = data; break;
    case QM_IN: e->in = data; break;
    case QM_OUT: e->out = data; break;
    default: break;
    }
  } else {
    switch (port) {
    case QS_IN: e->in = data; break;
    case QS_OUT: e->out = data; break;
    case QS_VU_A: e->vu_a = data; break;
    case QS_VU_B: e->vu_b = data; break;
    default: break;
    }
  }
}

static void activate(LV2_Handle h) { (void)h; }

static void run(LV2_Handle h, uint32_t frames) {
  struct eq10q *e = h;
  const int bypassed = e->kind == EQ10QM && e->bypass && *e->bypass > 0.5f;
  for (uint32_t i = 0; i < frames; i++) e->out[i] = bypassed ? e->in[i] : e->in[i];
  if (e->kind == EQ10QS) {
    if (e->vu_a) *e->vu_a = 0.0f;
    if (e->vu_b) *e->vu_b = 0.0f;
  }
}

static void deactivate(LV2_Handle h) { (void)h; }
static void cleanup(LV2_Handle h) { free(h); }
static const void *extension_data(const char *uri) { (void)uri; return NULL; }

static const LV2_Descriptor descriptors[KINDS] = {
  { URI_PREFIX "eq10qm", instantiate_qm, connect_port, activate, run, deactivate, cleanup, extension_data },
  { URI_PREFIX "eq10qs", instantiate_qs, connect_port, activate, run, deactivate, cleanup, extension_data },
};

LV2_SYMBOL_EXPORT const LV2_Descriptor *lv2_descriptor(uint32_t index) { return index < KINDS ? &descriptors[index] : NULL; }
