#!/bin/bash
# SessionStart hook (.claude/settings.json): make `dotnet test` able to run
# the Testcontainers-backed suites in services/Forge.Tests, which is 165 of
# its 257 tests — everything touching real Postgres/Redis/Azurite
# (cross-tenant authorization, the load tests, registry/publish gates,
# billing, play services). Without this they fail with
# DockerUnavailableException and the only honest thing to report is "not
# verified locally".
#
# Two separate problems, both handled here:
#
#   1. In the Claude Code cloud sandbox, dockerd is installed but nothing
#      starts it (no systemd — PID 1 isn't init), so the daemon is simply
#      down.
#   2. That sandbox's egress policy denies Docker Hub's blob CDN
#      (production.cloudfront.docker.com answers 403 through the agent
#      proxy), so even with the daemon up, `docker pull postgres:16`
#      fails. mirror.gcr.io — Google's public 1:1 Docker Hub mirror — is
#      allowed and serves the identical digests, so it's configured as a
#      registry mirror. Unqualified pulls (`postgres:16`, `redis:7` —
#      exactly what ForgeWebApplicationFactory.cs already asks for)
#      resolve through it transparently, with no change to any test code
#      or image pin.
#
# SAFETY: this is checked in, so it runs for anyone who opens this repo in
# Claude Code — including on a personal machine. It is therefore written to
# be a hard no-op anywhere but the sandbox above, and it never overwrites
# an existing Docker configuration:
#
#   - working Docker already?      -> exit immediately, touch nothing
#   - no dockerd installed?        -> exit
#   - not root?                    -> exit (can't start a daemon anyway)
#   - no agent proxy in the env?   -> exit (the mirror workaround is
#                                     specific to that egress policy, and
#                                     a normal machine must not be
#                                     reconfigured behind its owner's back)
#   - /etc/docker/daemon.json      -> left exactly as found; this only ever
#     already exists?                creates it when absent
#
# Never exits non-zero: a dev-convenience hook must not be able to block a
# session from starting. Anything unexpected is reported on stdout (which
# SessionStart surfaces as context) and the session continues.

# Deliberately no `set -e`: see the closing note above.
set -uo pipefail

# 1. Docker already usable (a normal dev machine, Docker Desktop, an
#    already-bootstrapped sandbox) — nothing to do.
if docker info > /dev/null 2>&1; then
  exit 0
fi

# 2. Nothing to start.
command -v dockerd > /dev/null 2>&1 || exit 0

# 3. Starting a daemon and writing /etc/docker both need root.
[ "$(id -u)" = "0" ] || exit 0

# 4. Only the sandbox whose egress policy this works around. On any other
#    machine a down daemon is the owner's business, not this hook's.
[ -n "${CCR_AGENT_PROXY_ENABLED:-}" ] || exit 0

# Only create the mirror config when there is none; never edit or replace
# a configuration someone else put there.
if [ ! -e /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json << 'JSON'
{
  "registry-mirrors": ["https://mirror.gcr.io"]
}
JSON
fi

nohup dockerd > /var/log/dockerd.log 2>&1 &
disown

for _ in $(seq 1 30); do
  docker info > /dev/null 2>&1 && break
  sleep 1
done

if ! docker info > /dev/null 2>&1; then
  echo "Note: tried to start dockerd for the Testcontainers tests and it did not come up; see /var/log/dockerd.log. The 165 container-backed tests in services/Forge.Tests will fail with DockerUnavailableException until it does."
  exit 0
fi

# Report what is actually configured, not what this script tried to
# configure — the pre-existing-daemon.json branch above deliberately
# leaves a config that may have no mirror, and claiming otherwise would
# be a false "verified" (CLAUDE.md Section 0: never present a guess as
# fact).
if docker info 2>/dev/null | grep -q "mirror.gcr.io"; then
  echo "Docker started, Docker Hub pulls mirrored via mirror.gcr.io. The Testcontainers-backed tests in services/Forge.Tests can run: dotnet test Forge.sln"
else
  echo "Docker started, but no registry mirror is configured (/etc/docker/daemon.json already existed and was left as-is). If image pulls fail with a 403 from the egress proxy, add {\"registry-mirrors\": [\"https://mirror.gcr.io\"]} to that file and restart dockerd."
fi

exit 0
