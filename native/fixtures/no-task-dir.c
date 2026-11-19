// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/* A preload for a test: opendir("/proc/self/task") fails, as on a host with no readable /proc, so the measurer cannot
 * count its threads. Every other directory opens as usual. Never installed. */
#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <string.h>

DIR *opendir(const char *name) {
  static DIR *(*real)(const char *);
  if (name != NULL && strcmp(name, "/proc/self/task") == 0) {
    errno = ENOENT;
    return NULL;
  }
  if (real == NULL) *(void **)&real = dlsym(RTLD_NEXT, "opendir");
  return real(name);
}
