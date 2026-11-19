// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * rt_interpose.test.c — the interposer's counters for other threads. While the audio thread's window is armed, a
 * plugin's worker and a host's pool helpers call into the interposer at once, and what they did is added to the
 * verdict under a pool (D20, plugin-qualify#53), so a lost update is a wrong verdict. N threads each take a private
 * mutex M times; the other-threads lock count must be exactly N * M. Compiled with the interposer's source itself, so
 * the counters under test are the ones the shipped build has. Run from anywhere; exit 0 is a pass.
 */
#include "rt-interpose.c"

#include <stdio.h>

#define THREADS 8
#define CALLS 400000u

static void *hammer(void *arg) {
  (void)arg;
  pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
  for (unsigned i = 0; i < CALLS; i++) {
    pthread_mutex_lock(&m);
    pthread_mutex_unlock(&m);
  }
  return NULL;
}

int main(void) {
  pthread_t t[THREADS];
  uint64_t alloc = 0, lock = 0, sys = 0;

  omx_rt_reset();
  omx_rt_begin();
  for (int i = 0; i < THREADS; i++) pthread_create(&t[i], NULL, hammer, NULL);
  for (int i = 0; i < THREADS; i++) pthread_join(t[i], NULL);
  omx_rt_end();
  omx_rt_other_counts(&alloc, &lock, &sys);
  if (lock != (uint64_t)THREADS * CALLS) {
    fprintf(stderr, "FAIL other-thread locks: %llu, want %llu (updates lost)\n", (unsigned long long)lock,
            (unsigned long long)THREADS * CALLS);
    return 1;
  }
  printf("rt_interpose: %llu other-thread locks counted exactly\n", (unsigned long long)lock);
  return 0;
}
