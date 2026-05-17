# CLI Updates With App Updates

## Problem or Goal

Users expect the public `orca` shell command to run the CLI bundled with the Orca app they just updated. That matters because CLI features can ship with the desktop app, such as parent-child workspace flags. If the shell command still resolves to an old app bundle, users see old CLI behavior even though they believe Orca is updated.

Goal: keep `orca` registered once, then make future app updates automatically route through the newly installed app bundle without asking users to reinstall the shell command.

Non-goals:

- Do not ship a separate npm/Homebrew CLI package.
- Do not make the CLI self-update independently of the app.
- Do not auto-replace unrelated commands named `orca`.

## Current Behavior

- Packaged builds copy a platform launcher into the app resources: Windows copies `resources/win32/bin/orca.cmd` to `resources/bin/orca.cmd`, macOS copies `resources/darwin/bin/orca` to `Contents/Resources/bin/orca`, and Linux copies `resources/linux/bin/orca` to `resources/bin/orca` ([config/electron-builder.config.cjs:92](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/config/electron-builder.config.cjs:92), [config/electron-builder.config.cjs:148](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/config/electron-builder.config.cjs:148), [config/electron-builder.config.cjs:181](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/config/electron-builder.config.cjs:181)).
- The CLI runtime is intentionally unpacked from `app.asar` so the launcher can execute it with `ELECTRON_RUN_AS_NODE` ([config/electron-builder.config.cjs:37](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/config/electron-builder.config.cjs:37), [config/electron-builder.config.cjs:54](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/config/electron-builder.config.cjs:54)).
- The macOS bundled launcher resolves the `.app` path from the launcher location, then runs `Contents/Resources/app.asar.unpacked/out/cli/index.js` through the bundled Electron binary ([resources/darwin/bin/orca:4](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/darwin/bin/orca:4), [resources/darwin/bin/orca:21](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/darwin/bin/orca:21)).
- The Linux and Windows bundled launchers resolve the executable and CLI relative to their own resources directory ([resources/linux/bin/orca:4](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/linux/bin/orca:4), [resources/linux/bin/orca:17](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/linux/bin/orca:17), [resources/win32/bin/orca.cmd:3](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/win32/bin/orca.cmd:3), [resources/win32/bin/orca.cmd:17](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/resources/win32/bin/orca.cmd:17)).
- `CliInstaller` currently registers `/usr/local/bin/orca` on macOS, `~/.local/bin/orca` on Linux, and `%LOCALAPPDATA%\\Programs\\Orca\\bin\\orca.cmd` on Windows ([src/main/cli/cli-installer.ts:12](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:12), [src/main/cli/cli-installer.ts:199](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:199)).
- For packaged apps, `CliInstaller` treats the bundled resources launcher as the expected target ([src/main/cli/cli-installer.ts:222](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:222), [src/main/cli/cli-installer.ts:622](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:622)).
- POSIX installs create a symlink directly to the bundled launcher; Windows writes a forwarding `.cmd` to the bundled launcher ([src/main/cli/cli-installer.ts:240](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:240), [src/main/cli/cli-installer.ts:278](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:278), [src/main/cli/cli-installer.ts:529](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/cli/cli-installer.ts:529)).
- The settings UI exposes manual install/remove/status refresh, but there is no startup repair or updater-specific reconciliation of CLI registration ([src/main/ipc/cli.ts:5](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/ipc/cli.ts:5), [src/renderer/src/components/settings/CliSection.tsx:51](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/renderer/src/components/settings/CliSection.tsx:51), [src/renderer/src/components/settings/CliSection.tsx:73](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/renderer/src/components/settings/CliSection.tsx:73)).
- App updates are handled by `electron-updater`; `quitAndInstall()` schedules replacement/restart, and `setupAutoUpdater()` registers updater handlers, but neither path touches CLI registration ([src/main/updater.ts:607](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/updater.ts:607), [src/main/updater.ts:697](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/updater.ts:697), [src/main/updater.ts:778](/Users/thebr/orca/workspaces/orca/cli-update-from-last-release/src/main/updater.ts:778)).

Important implication: if `/usr/local/bin/orca` points to `/Applications/Orca.app/Contents/Resources/bin/orca` and the updater replaces `/Applications/Orca.app` in place, the CLI should update naturally. The gap is that Orca does not currently prove or repair this invariant after updates, app moves, legacy registrations, or Windows wrapper drift.

## Ref-OSS Findings

Used `ref-oss`, synced repos with `scripts/sync-ref-oss.sh --all`, and inspected `/Users/thebr/projects/orca-ref-oss/vscode`.

Relevant VS Code patterns:

- VS Code's macOS `code` command is a symlink to a launcher inside the app bundle. The launcher resolves the `.app` from its own path and runs the bundled CLI with `ELECTRON_RUN_AS_NODE` ([/Users/thebr/projects/orca-ref-oss/vscode/resources/darwin/bin/code.sh:15](/Users/thebr/projects/orca-ref-oss/vscode/resources/darwin/bin/code.sh:15), [/Users/thebr/projects/orca-ref-oss/vscode/resources/darwin/bin/code.sh:31](/Users/thebr/projects/orca-ref-oss/vscode/resources/darwin/bin/code.sh:31)).
- VS Code installs `/usr/local/bin/<appName>` to the app's bundled `bin/code` and only replaces it when the existing symlink target differs ([/Users/thebr/projects/orca-ref-oss/vscode/src/vs/platform/native/electron-main/nativeHostMainService.ts:470](/Users/thebr/projects/orca-ref-oss/vscode/src/vs/platform/native/electron-main/nativeHostMainService.ts:470), [/Users/thebr/projects/orca-ref-oss/vscode/src/vs/platform/native/electron-main/nativeHostMainService.ts:550](/Users/thebr/projects/orca-ref-oss/vscode/src/vs/platform/native/electron-main/nativeHostMainService.ts:550)).
- VS Code exposes explicit command-palette install/uninstall actions rather than silently claiming arbitrary commands ([/Users/thebr/projects/orca-ref-oss/vscode/src/vs/workbench/electron-browser/actions/installActions.ts:19](/Users/thebr/projects/orca-ref-oss/vscode/src/vs/workbench/electron-browser/actions/installActions.ts:19)).
- VS Code's Linux packages register `/usr/bin/code` as a symlink to the package-owned app launcher, so package updates replace the target in place ([/Users/thebr/projects/orca-ref-oss/vscode/resources/linux/debian/postinst.template:6](/Users/thebr/projects/orca-ref-oss/vscode/resources/linux/debian/postinst.template:6), [/Users/thebr/projects/orca-ref-oss/vscode/resources/linux/rpm/code.spec.template:39](/Users/thebr/projects/orca-ref-oss/vscode/resources/linux/rpm/code.spec.template:39)).
- VS Code's Windows launcher can include a versioned resources path when the install layout needs it ([/Users/thebr/projects/orca-ref-oss/vscode/resources/win32/versioned/bin/code.cmd:1](/Users/thebr/projects/orca-ref-oss/vscode/resources/win32/versioned/bin/code.cmd:1), [/Users/thebr/projects/orca-ref-oss/vscode/build/gulpfile.vscode.ts:450](/Users/thebr/projects/orca-ref-oss/vscode/build/gulpfile.vscode.ts:450)).

Implementation should reuse the VS Code principle, not necessarily its exact mechanics: the public command should be a stable entrypoint whose first hop is app-owned, and the app should only repair launchers it can prove are Orca-owned.

## Proposed Design

System model:

```text
User shell
  |
  | PATH lookup
  v
Public command
  macOS: /usr/local/bin/orca
  Linux: ~/.local/bin/orca
  Windows: %LOCALAPPDATA%\Programs\Orca\bin\orca.cmd
  |
  | symlink or managed wrapper, installed once
  v
Stable user-data launcher
  <app.getPath('userData')>/cli/bin/orca(.cmd)
  |
  | rewritten by the currently running packaged app
  v
Bundled launcher in current app resources
  process.resourcesPath/bin/orca(.cmd)
  |
  | ELECTRON_RUN_AS_NODE
  v
Unpacked CLI entrypoint
  app.asar.unpacked/out/cli/index.js
```

The load-bearing invariant is that the public command points to the stable user-data launcher, not directly to a versioned or movable app bundle. Startup reconciliation is responsible for keeping that stable launcher pointed at the currently running app.

### 1. Add an App-Managed Stable Launcher

Create a packaged-app stable launcher under user data:

- macOS/Linux: `<app.getPath('userData')>/cli/bin/orca`
- Windows: `<app.getPath('userData')>\\cli\\bin\\orca.cmd`

On every packaged app startup, rewrite this stable launcher to forward to the current bundled launcher:

- macOS/Linux: `exec "<current process.resourcesPath>/bin/orca" "$@"`
- Windows: `call "<current process.resourcesPath>\\bin\\orca.cmd" %*`

Write this launcher through a platform-local atomic replace:

- Ensure the parent directory exists first.
- Write the new content to a temp file in the same directory.
- Set POSIX executable mode before the rename.
- Rename over the previous launcher.
- Skip the rename when existing content already matches, to reduce churn.

Atomic replace matters because the CLI can be invoked from a shell while the app is starting. The user should either run the previous valid launcher or the new valid launcher, never a truncated script.

Keep the bundled resource launchers as the canonical launchers for executing the CLI. The stable launcher is only a durable first hop that can be rewritten without needing `/usr/local/bin` or machine PATH privileges.

Development builds can keep the current generated launcher path, but should share the same atomic-write helper names so install-status tests cover both packaged and dev launchers.

### 2. Change Public Registration to Point at the Stable Launcher

Update `CliInstaller.resolveLauncherPath()` for packaged builds to return the app-managed stable launcher, creating/refreshing it first. Existing `getBundledLauncherPath()` remains as an internal target for the stable launcher.

Install behavior:

- POSIX: `/usr/local/bin/orca` or `~/.local/bin/orca` symlinks to the stable user-data launcher.
- Windows: the PATH-visible `orca.cmd` forwards to the stable user-data launcher.

This means app updates only need to rewrite the user-data launcher on restart; the public command's PATH-visible hop does not need privileged repair after the first install.

Status inspection should classify the current public command into explicit ownership buckets:

- `installed`: exact symlink/wrapper to the stable launcher.
- `legacy_bundled`: Orca-owned symlink/wrapper to the bundled launcher from the current direct-registration design.
- `legacy_bundled_elsewhere`: Orca-shaped symlink/wrapper to a bundled launcher under another app path, usually from an app move or replacement outside the normal updater path.
- `stale_orca`: Orca-shaped target that is not one the app can confidently rewrite silently.
- `conflict`: non-Orca file or unknown wrapper.
- `not_installed`: missing public command.

Only `installed` is fully healthy. `legacy_bundled` and `legacy_bundled_elsewhere` are migratable by startup reconciliation when the public path is user-writable and inspection proves the target matches Orca's generated launcher shape; otherwise Settings should report a repair action instead of implying that the CLI is unusable.

### 3. Startup Reconciliation for Existing Users

Add `CliInstaller.reconcileAfterAppUpdate()` and call it once during main-process startup after app paths are available and before the renderer asks for CLI status. A good location is near other startup-owned user-global setup in `src/main/index.ts` after service initialization, with errors logged but not fatal.

Reconciliation rules:

- Always refresh the stable user-data launcher to the currently running app.
- If the public command is not installed, do nothing.
- If the public command already points to the stable launcher, do nothing.
- If the public command points to the current bundled launcher from an older Orca version of this installer, migrate it to the stable launcher.
- If the public command points to a recognizable legacy bundled Orca launcher at another app path, migrate it only when the replacement can be done without elevation and the target matches Orca's generated symlink/wrapper shape.
- If the public command points elsewhere, preserve the existing `stale` or `conflict` status and require explicit user action.
- Never show an administrator prompt during startup. If `/usr/local/bin` cannot be rewritten automatically, leave status actionable in Settings.

This keeps updates quiet when everything is healthy, while avoiding surprise ownership changes.

The method should return a small result object for tests and logging, for example `refreshed_stable_launcher`, `already_installed`, `migrated_legacy_launcher`, `permission_denied`, `not_installed`, or `conflict_preserved`. The caller logs non-success results but never blocks startup.

### 4. Clarify Status and User-Facing Copy

Keep the existing public `CliInstallStatus.state` values unless implementation needs a new state. Prefer using `detail` to explain:

- `installed`: registered and managed by Orca.
- `stale`: points to another launcher; use Settings to repair.
- `conflict`: path exists but is not an Orca symlink/wrapper.

Settings should continue to show the command path and existing target. If reconciliation failed due to permissions, the existing install action should repair it through the current elevated macOS fallback.

User-facing states:

| State | User meaning | Action |
| --- | --- | --- |
| Installed | `orca` is managed by Orca and follows app updates after the app launches. | No action. |
| Legacy direct launcher | `orca` still points at an older Orca-managed launcher shape. It may work for same-path updates, but future app moves require repair. | Auto-migrate if ownership is provable and the public path is writable; otherwise show Register/Repair. |
| Stale | `orca` points to another Orca-looking location that cannot be safely migrated. | Show Register/Repair. |
| Conflict | The path is occupied by something Orca cannot prove it owns. | Do not replace automatically; explain the path conflict. |
| Not installed | No public command exists. | Show Register. |

### 5. Updater Hook Is Optional, Startup Repair Is Required

Do not rely only on `quitAndInstall()` because users can update by replacing the app bundle, Homebrew cask, external package manager, or OS-level installer. Startup reconciliation covers all update sources after the new app launches.

The updater path can optionally log a breadcrumb when an install completes, but the actual CLI repair should be idempotent startup work.

Update data flows:

```text
Happy path, same app path:
old /usr/local/bin/orca -> stable launcher -> /Applications/Orca.app/.../bin/orca
app replaced in place
stable launcher path still resolves to /Applications/Orca.app/.../bin/orca
next app launch rewrites the same content if needed
```

```text
Moved app path:
public command -> stable launcher -> old app resources
user launches Orca from new location
startup rewrites stable launcher -> new process.resourcesPath/bin/orca
future shell invocations reach the new app
```

```text
Legacy direct registration:
public command -> current bundled launcher
startup refreshes stable launcher
startup migrates public command -> stable launcher when writable
if not writable, status remains actionable and Settings repair can elevate
```

```text
Legacy direct registration after app move:
public command -> old Orca.app resources
user launches Orca from new location
startup refreshes stable launcher -> new process.resourcesPath/bin/orca
startup migrates public command -> stable launcher when the old target is provably Orca-owned and the public path is writable
if not writable or not provable, Settings shows repair instead of silently replacing it
```

```text
Conflict or unknown wrapper:
public command -> non-Orca target
startup refreshes stable launcher only
public command is preserved and Settings explains the conflict
```

### 6. Security and Ownership Boundaries

The stable launcher lives in user data, so it is not a trust boundary. It must never grant additional privileges; it only forwards to the current app's bundled launcher as the same user. This is acceptable because a same-user process that can edit user data can already affect that user's PATH, shell startup files, and Windows user environment.

The public command remains the ownership boundary. Startup reconciliation may only rewrite it when inspection proves it is Orca-owned or the path is missing. Unknown files, non-symlink POSIX commands, and wrappers that do not match Orca's generated templates stay untouched.

## Edge Cases

- Same-path app update: `/Applications/Orca.app` is replaced in place; both legacy direct symlinks and new stable launchers should resolve to the new bundle.
- App moved after registration: the stable launcher is rewritten on next launch from the new location; legacy direct symlinks may need migration if the command still points at the old app.
- CLI invoked before the updated app is launched once: same-path updates work; moved-app updates may still hit the old path until Orca starts and rewrites the stable launcher.
- Permission denied for `/usr/local/bin`: do not prompt on startup; keep Settings repair available.
- PATH collision: do not replace a non-symlink POSIX command or unknown Windows wrapper.
- Linux package conflict with GNOME Orca: keep the current user-scoped `~/.local/bin/orca` default; do not claim `/usr/bin/orca`.
- Windows app update layout changes: generated wrappers should forward through the stable user-data launcher so versioned or relocated resources only require rewriting one app-managed file.
- SSH/remote runtime: local shell-command registration is a local desktop concern. Remote `orca` commands should continue to use their remote installation or pairing/environment configuration; do not assume a local app path exists on SSH targets.
- App translocation/quarantine on macOS: the stable launcher should be refreshed only from a running packaged app. If the app is translocated, status can still show the concrete target so users can move Orca into `/Applications`.
- Downgrade or rollback: startup refresh points to the currently running app, so CLI behavior follows the installed app version in either direction.
- Concurrent startup/status calls: both paths may refresh the stable launcher. Atomic replace and content equality checks make this harmless.

## Test Plan

Unit coverage:

- Add `src/main/cli/cli-installer.test.ts` cases for packaged-mode stable launcher creation on macOS, Linux, and Windows.
- Verify install points the public command at the stable launcher, not directly at `resources/bin/orca`.
- Verify rewriting the stable launcher from fake version `1` to fake version `2` changes the downstream bundled launcher path without changing the public symlink/wrapper.
- Verify stable launcher refresh is atomic by pre-creating an old launcher, forcing a rewrite, and asserting the final content is complete and executable.
- Verify migration from the current legacy direct symlink target to the stable launcher.
- Verify migration from a recognizable legacy direct symlink/wrapper under an old app path when the public command path is writable.
- Verify stale/conflict commands are not auto-replaced.
- Verify permission failures during startup reconciliation are non-fatal and leave actionable status.
- Verify Windows wrapper comparison treats the current stable-launcher wrapper as installed and an old direct-bundled wrapper as migratable.
- Verify generated Windows wrappers preserve arguments with spaces and propagate the bundled launcher's exit code.

Build/package coverage:

- Add or extend a packaging smoke test that asserts each platform artifact contains `resources/bin/orca` or `resources/bin/orca.cmd` plus the unpacked CLI entrypoint.
- Add a script-level smoke test with a fake app path: register `orca`, replace the fake app's bundled launcher with a new version marker, rerun startup reconciliation, then assert invoking the public command reaches the new marker.

Playwright/Electron coverage:

- Add an Electron/Playwright test for Settings > Orca CLI status using mocked `CliInstaller` paths if the current test harness supports main-process dependency injection.
- If full updater simulation is too heavy, cover the user-visible repair path: stale legacy target appears in Settings, clicking Register repairs it, refreshing shows installed.

Manual validation:

- macOS release-like packaged build: install shell command, confirm `command -v orca`, update/replace `Orca.app` at the same path, relaunch, confirm `orca --help` or a version marker comes from the new app.
- macOS moved app: register from one app path, move app, launch moved app, confirm startup reconciliation either repairs without prompting or Settings reports repair action.
- Windows packaged build: confirm user PATH command survives update and invokes the new app's bundled CLI.
- Linux AppImage/deb: confirm `~/.local/bin/orca` follows the refreshed launcher and does not touch `/usr/bin/orca`.

## Rollout Order

1. Add stable-launcher helpers and tests while keeping current public install behavior unchanged.
2. Change packaged install/status resolution to use the stable launcher; keep recognizing legacy direct bundled launchers.
3. Add startup reconciliation and non-fatal logging.
4. Update Settings copy only if status wording changes.
5. Add packaging and Electron coverage.
6. Ship in one release, then monitor support reports for stale `/usr/local/bin/orca` and Windows PATH wrapper drift.

## Ref-OSS Reuse

Ref-OSS was used. Reuse these implementation patterns:

- VS Code's app-bundle-relative launcher model for the canonical bundled launcher.
- VS Code's conservative ownership check before replacing the public shell command.
- VS Code's explicit user repair flow for privileged shell command installation.

Do not reuse VS Code's Linux `/usr/bin` package ownership as-is because Orca intentionally avoids colliding with GNOME Orca.
