#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <sched.h>
#include <sys/prctl.h>
#include <unistd.h>

int main() {
  if (getuid() == 0 || geteuid() != getuid() || getgid() == 0 || getegid() != getgid() ||
      getgroups(0, nullptr) != 0 || prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1) return 78;
  FILE* status = std::fopen("/proc/self/status", "r");
  if (status == nullptr) return 78;
  char line[512];
  int verified = 0;
  while (std::fgets(line, sizeof(line), status) != nullptr) {
    for (const char* field : {"CapInh:", "CapPrm:", "CapEff:", "CapBnd:", "CapAmb:"}) {
      if (std::strncmp(line, field, std::strlen(field)) != 0) continue;
      unsigned long long value = 1;
      if (std::sscanf(line + std::strlen(field), "%llx", &value) != 1 || value != 0) {
        std::fclose(status);
        return 78;
      }
      verified++;
    }
  }
  if (std::fclose(status) != 0 || verified != 5) return 78;
  const int result = unshare(CLONE_NEWUSER);
  const int namespaceError = errno;
  const char* outcome = result == 0 ? "allowed"
    : namespaceError == EPERM || namespaceError == EACCES ? "denied" : "unverified";
  if (result == 0) {
    FILE* label = std::fopen("/proc/self/attr/current", "r");
    if (label == nullptr) return 78;
    char current[4096];
    if (std::fgets(current, sizeof(current), label) == nullptr || std::fclose(label) != 0) return 78;
    if (std::strcmp(current, "unprivileged_userns (enforce)\n") == 0) outcome = "restricted";
  }
  std::printf("{\"identityVerified\":true,\"pid\":%ld,\"outcome\":\"%s\"}\n",
    static_cast<long>(getpid()), outcome);
  return 0;
}
