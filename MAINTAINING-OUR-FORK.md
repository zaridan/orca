# Maintaining our Orca (this fork)

This fork — **`zaridan/orca`** — is "our Orca": the official app (`stablyai/orca`) **plus** our changes:

- **Orcastrator** — a director that plans multi-worktree work and runs worker agents (sidebar + launch modal + Send to Orcastrator + Mission Control).
- **Jira fixes** — non-browser User-Agent (fixes the XSRF 403 on issue search/create) and surfacing search failures instead of a misleading empty list.

Both live on **`main`**. `main` = upstream + our patches.

## Run our build (always)

Run **our** build, not the official app — running ours *is* running our updates.

```bash
./scripts/rebuild-ours.sh        # build the native arm64 app from main
open dist/mac-arm64/Orca.app     # run it
```

Install it if you like: `cp -R dist/mac-arm64/Orca.app /Applications/`.

## Get the latest official changes, keep our features

When the official app ships updates you want, fold them in and rebuild:

```bash
./scripts/rebuild-ours.sh --sync
```

This merges `upstream/main` into our `main` (our Orcastrator + Jira ride on top), pushes, and rebuilds. If the merge conflicts (upstream touched the same files), resolve them, `git commit`, and re-run.

## Why the official app can't clobber ours

Two things protect "our" build:

1. **The auto-update feed points at our fork, not official.** `config/electron-builder.config.cjs` `publish` is set to `owner: 'zaridan'`. Without this, an installed build would silently auto-update to the official release and wipe our changes.
2. **Run ours from its own location.** Our build is still named `Orca` (same as official). If you *also* keep the official Orca installed, give ours a distinct name so the two don't overwrite each other:

   ```bash
   cp -R dist/mac-arm64/Orca.app "/Applications/Orca (Ours).app"
   ```

   Simplest path: just run ours and don't install the official one.

## Share a build (e.g. with Tito — Apple Silicon)

```bash
./scripts/rebuild-ours.sh --dmg     # → dist/orca-macos-arm64.dmg
```

Attach the `.dmg` to a GitHub Release on the fork. The build is signed with a personal Apple Development cert but **not notarized**, so on first open the recipient does:

> **Right-click `Orca.app` → Open → Open** (once). Or: `xattr -dr com.apple.quarantine /Applications/Orca.app`.

(For friction-free distribution you'd enroll in the Apple Developer Program and notarize — not set up here.)

## Where our work lives

- Branches `feat/orcastrators-sidebar` (Orcastrator) and `fix/jira-fixes` (Jira) are merged into `main`.
- The Orcastrator feature is also offered upstream as a PR to `stablyai/orca`, so they can take it or not — independent of this fork.
