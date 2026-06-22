#!/usr/bin/env bash
#
# Rebuild "our Orca" — this fork (zaridan/orca) = upstream + Orcastrator + Jira fixes —
# as a native Apple Silicon (arm64) app.
#
#   ./scripts/rebuild-ours.sh           # rebuild from the current fork main
#   ./scripts/rebuild-ours.sh --sync    # pull the latest OFFICIAL changes first, then rebuild
#   ./scripts/rebuild-ours.sh --dmg     # also produce a shareable installer (dist/orca-macos-arm64.dmg)
#
# Run OUR build, not the official app — running this IS running our updates.
# See MAINTAINING-OUR-FORK.md for the full model.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- Apple Silicon toolchain: arm64 Homebrew + fnm Node 24 (native, not Rosetta) ---
eval "$(/opt/homebrew/bin/brew shellenv)"
export FNM_ARCH=arm64
eval "$(/opt/homebrew/bin/fnm env)"
/opt/homebrew/bin/fnm use 24

WANT_DMG=0
WANT_SYNC=0
for arg in "$@"; do
  case "$arg" in
    --dmg) WANT_DMG=1 ;;
    --sync) WANT_SYNC=1 ;;
    *) echo "unknown option: $arg (use --sync and/or --dmg)"; exit 2 ;;
  esac
done

git checkout main

if [ "$WANT_SYNC" -eq 1 ]; then
  echo "==> Pulling the latest official changes from upstream/main"
  git fetch upstream
  if ! git merge --no-edit upstream/main; then
    echo "!! Conflict merging upstream. Resolve the files, 'git commit', then re-run." >&2
    exit 1
  fi
  git push origin main || echo "(could not push main; continuing with the local build)"
fi

echo "==> Installing dependencies (pnpm via corepack)"
corepack pnpm install --frozen-lockfile || corepack pnpm install

if [ "$WANT_DMG" -eq 1 ]; then
  echo "==> Building the arm64 installer (.dmg)"
  corepack pnpm build:desktop
  corepack pnpm build:computer-macos
  corepack pnpm ensure:electron-runtime
  corepack pnpm exec electron-builder --config config/electron-builder.config.cjs --mac dmg --arm64
  echo "==> Installer: $(ls dist/*.dmg 2>/dev/null | head -1)"
fi

echo "==> Building the native arm64 app"
corepack pnpm build:unpack

APP="dist/mac-arm64/Orca.app"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo ""
echo "==> Done. Built: $APP"
echo "    Run:     open \"$APP\""
echo "    Install: cp -R \"$APP\" /Applications/"
echo "    (If you also keep the official Orca, install ours under a distinct name,"
echo "     e.g. /Applications/'Orca (Ours).app', so the two don't overwrite each other.)"
