#!/bin/sh
# The admin part of the https://zeff setup on macOS and Linux, run as root by the launcher
# (osascript / pkexec):
#   - hosts: "127.0.0.1 <names>", tagged "# zeff-launcher" (replaces an earlier one)
#   - Linux: the CA in the system store (update-ca-certificates / update-ca-trust)
# Usage: setup-elevated.sh <name,name,...> [ca.cer]. Exit code 0 = everything done.
set -u
names=$(printf '%s' "$1" | tr ',' ' ')
cer=${2:-}
ok=0

tmp=$(mktemp)
if [ ! -e /etc/hosts ] || [ -r /etc/hosts ]; then
  [ -e /etc/hosts ] && grep -v '# zeff-launcher' /etc/hosts > "$tmp"
  printf '127.0.0.1\t%s\t# zeff-launcher\n' "$names" >> "$tmp"
  # cat keeps the file's owner and mode
  if cat "$tmp" > /etc/hosts; then echo "hosts: 127.0.0.1 $names"; else echo "hosts: not written"; ok=1; fi
else
  echo "hosts: not readable"
  ok=1
fi
rm -f "$tmp"
if [ "$(uname)" = Darwin ]; then
  dscacheutil -flushcache 2>/dev/null
  killall -HUP mDNSResponder 2>/dev/null
fi

if [ -n "$cer" ]; then
  if [ -d /usr/local/share/ca-certificates ] && command -v update-ca-certificates >/dev/null; then
    cp "$cer" /usr/local/share/ca-certificates/zeff-local-ca.crt && update-ca-certificates >/dev/null && echo "system store: trusted the Zeff Local CA" || ok=1
  elif [ -d /etc/pki/ca-trust/source/anchors ] && command -v update-ca-trust >/dev/null; then
    cp "$cer" /etc/pki/ca-trust/source/anchors/zeff-local-ca.crt && update-ca-trust && echo "system store: trusted the Zeff Local CA" || ok=1
  else
    echo "system store: unknown layout, skipped"
  fi
fi
exit $ok
