#!/bin/sh
# Starts Zeff on Linux — what the bundle's ./zeff is (and its menu and autostart entries run).
#
# Electron's sandbox needs either unprivileged user namespaces (which Ubuntu 24.04's AppArmor
# restricts) or chrome-sandbox owned by root with the setuid bit, which an unpacked archive can't
# have. Without that the launcher runs with --no-sandbox — its only window is its own status
# page. To keep the sandbox: sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox
here=$(dirname "$(readlink -f "$0")")
export ZEFF_LAUNCHER="$here/zeff"
sandbox="$here/chrome-sandbox"
if [ -u "$sandbox" ] && [ "$(stat -c %u "$sandbox")" = 0 ]; then
  exec "$here/zeff-launcher" "$@"
fi
exec "$here/zeff-launcher" --no-sandbox "$@"
