#!/usr/bin/env bash
set -euo pipefail
tool=$(mktemp -d "${RUNNER_TEMP:-/tmp}/growth-gitleaks.XXXXXX")
trap 'rm -rf "$tool"' EXIT
curl -fsSL -o "$tool/archive.tgz" https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
printf '%s  %s\n' 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb "$tool/archive.tgz" | sha256sum -c -
tar -xzf "$tool/archive.tgz" -C "$tool" gitleaks
"$tool/gitleaks" git . --redact --exit-code 1
