#!/bin/sh
# A stand-in for the vendor's installer: prints, waits a little, and puts the stand-in `opencode`
# where the vendor installer lands: `$HOME/.opencode/bin/opencode`. `fail` as
# the first argument makes it the installer that does not finish. Never run against a real home.
here=$(cd "$(dirname "$0")" && pwd)
echo "stand-in installer: downloading…"
sleep 1
if [ "$1" = "fail" ]; then
  echo "stand-in installer: the download failed (this is the failing variant)"
  exit 7
fi
mkdir -p "$HOME/.opencode/bin"
cp "$here/opencode" "$HOME/.opencode/bin/opencode"
cp "$here/opencode.ts" "$HOME/.opencode/bin/opencode.ts"
chmod +x "$HOME/.opencode/bin/opencode"
echo "stand-in installer: installed to $HOME/.opencode/bin/opencode"
