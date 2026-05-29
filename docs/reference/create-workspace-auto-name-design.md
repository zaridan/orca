# Create Workspace Auto-Name and Source Picker

## Problem

The create workspace flow currently makes users choose or type a workspace name before the workspace has useful context. That conflicts with the "auto-name from first message" behavior: if the user selects a GitHub, GitLab, Linear, or branch source, the composer often turns that source into the workspace name up front, so there is nothing left for the first-message rename path to do.

The modal also gives too much visual weight to optional source/name controls. Users with auto-name enabled should be able to pick a project and agent, create the workspace, and let Orca name it from the first agent task. Source attachment, branch selection, and manual naming should remain available, but should read as optional shortcuts.

## Goals

- Default `autoRenameBranchFromWork` on for new settings.
- Keep the create modal small: Project, Agent, optional icon row, Advanced, Create.
- Remove the prominent "Name or 'Create From' [Optional]" style field from the default path.
- Let users attach a work item, start from a branch, and set a custom name without disabling the first-message auto-name path by accident.
- Use one shared source picker for work items and branches.
- Preserve SSH, GitLab, and other provider behavior; do not make this GitHub-only.

## Non-Goals

- Redesign branch rename generation or prompt summarization.
- Rename branches that the user explicitly named, or branches with upstreams.
- Change direct launch flows outside the create workspace modal unless they share the same composer state.
- Add new telemetry unless an existing event needs a source value kept accurate.

## Current Behavior

- Defaults live in `src/shared/constants.ts`; `autoRenameBranchFromWork` is currently `false`.
- First-work rename is handled in `src/main/agent-hooks/first-work-branch-rename.ts`. It already gates on the setting, Orca-created worktrees, auto-generated creature branch names, and no upstream.
- The modal/card is rendered by `src/renderer/src/components/NewWorkspaceComposerCard.tsx`.
- Source search/manual name are combined in `src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx`.
- Create state and source selection are coordinated in `src/renderer/src/hooks/useComposerState.ts`.

## Design

### 1. Default Auto-Name On

Change the default settings object so `autoRenameBranchFromWork` defaults to `true`.

Do not silently overwrite an existing persisted user setting. Existing users who explicitly have it off should keep that value unless we add a deliberate migration later.

The setting in `src/renderer/src/components/settings/GitPane.tsx` remains available so users can turn the behavior off.

### 2. Decouple Source From Manual Name

Treat "selected source" and "workspace name" as separate pieces of composer state.

- `workspaceName` / `name`: user-typed custom name only.
- `selectedSource`: work item or branch context selected from the picker.
- `baseBranch`: branch/ref to start from.
- linked work item metadata: GitHub/GitLab/Linear issue or PR/MR data passed into create and agent prompt setup.

Selecting a source should not call `setName(...)` unless the user explicitly clicks the custom-name control or types in the custom-name input.

The create path should still have a temporary seed name for filesystem/worktree creation. That seed can remain the existing creature/default name. The first-work rename logic will later replace the branch/display name when eligible.

### 3. Compact Default Modal

Default modal layout:

1. Title: `Create Worktree`
2. Project picker
3. Agent picker
4. Optional row: `Or:` followed by three icon-only buttons
5. `Advanced` disclosure
6. Primary action: `Create Worktree`

The optional row:

- Issue/work-item icon: use a provider-neutral issue glyph such as `CircleDot`; tooltip `Attach issue`.
- Branch icon: tooltip `Start from branch`.
- Text icon: tooltip `Set a custom name`.

Each button must have an `aria-label` matching the tooltip. Tooltips should be hover/focus-visible only so touch users do not get a stuck tooltip after tapping.

### 4. Shared Source Picker

The issue icon and branch icon open the same popover.

Picker shape:

- Search input at the top with placeholder `Search issues, PRs, branches`.
- Tabs: `All`, `GitHub`, `GitLab`, `Linear`, `Branch`.
- `All` is the default active tab.
- Results may include issues, PRs/MRs, Linear issues, and branches in the same list.

Implementation detail: the internal mode id can stay `smart` if that avoids churn, but the visible label should be `All`.

Selecting a result:

- GitHub/GitLab/Linear work item: store selected source/linked item metadata and render a small removable pill.
- Branch: update `baseBranch`/branch selection state and render a small removable pill or selected-state label. Do not force a manual workspace name.
- Manual name remains controlled only by the text icon/custom-name input.

### 5. Advanced Section

Advanced should hold controls that are useful but not required for the common path:

- Custom name input.
- Base branch/start-from field if needed as a text fallback.
- Setup decision controls.
- Sparse checkout controls.
- SSH reconnect state or other repo-specific gates.

Do not duplicate the main source picker as a full-width "Create From" field in Advanced. If Advanced needs to show current source/base state, render it as compact state or editable fallback controls.

### 6. SSH And Provider Gates

Keep the existing selected repo SSH gate behavior from `src/renderer/src/lib/new-workspace-ssh-gate.ts`.

When the selected repo requires reconnect:

- Disable source picker buttons that require repo/provider access.
- Keep custom naming available if it does not require remote repo access.
- Surface the reconnect state inline using the existing create gate/error style.

Provider support remains conditional:

- Hide GitLab tab when GitLab support is unavailable.
- Hide Linear tab when Linear is not connected.
- Keep the `All` tab visible and provider-neutral.

### 7. Auto-Name Reconciliation

Auto-name should win unless the user explicitly sets a custom name.

Rules:

- Blank custom-name input means "auto-name this workspace from the first agent task."
- Attached work items provide launch context and prompt scaffolding, not the workspace name.
- Branch selections provide base/start context, not the workspace name.
- Typed custom name opts out of display-name replacement for that workspace.
- Existing main-process safety checks still protect branches that are not Orca-created, not creature-named, detached, or already published.

This reconciles the selector row with first-message naming: the row answers "what should this workspace start from or attach to?", while auto-name answers "what should this workspace be called after work starts?"

## Implementation Notes

- `src/shared/constants.ts`: change the default setting to `true`.
- `src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx`: split the visible trigger UI from the underlying search/picker. The source picker should support externally requested open modes from both issue and branch buttons.
- `src/renderer/src/hooks/useComposerState.ts`: audit `setName(...)` calls in source-selection handlers. Source/branch/work-item handlers should update source/base/linked metadata without setting `name`.
- `src/renderer/src/components/NewWorkspaceComposerCard.tsx`: replace the full source/name field in the default layout with the compact optional row and move custom name behind the text icon/Advanced.
- Keep existing direct launch helpers, such as `src/renderer/src/lib/launch-work-item-direct.ts`, behaviorally stable unless they intentionally share the new source-selection model.

## Edge Cases

- User attaches an issue and types no name: create with a temporary seed name, then first-work auto-rename may rename branch/display name from the first agent task.
- User attaches an issue and types a custom name: keep the custom display name; first-work branch rename should still only act if the branch is eligible and creature-named.
- User selects a branch: start from that branch, but leave custom name blank unless explicitly typed.
- User selects a PR/MR that resolves a start branch: update base/start metadata and linked source metadata, but do not turn the PR/MR title into the workspace name.
- Remote repo disconnected: source picker and create action are gated until reconnect, while local-only custom name editing remains possible.
- GitLab unavailable or Linear disconnected: provider tabs are omitted, `All` still renders available result types.

## Test Plan

- Unit: default settings test expects `autoRenameBranchFromWork: true`.
- Unit: composer source-selection handlers do not call `setName` for GitHub/GitLab/Linear/branch selections.
- Unit: typing in the custom-name input still sets manual name and create uses it.
- Unit: branch icon and issue icon both open the same picker state.
- Unit/component: first tab visible label is `All`, search input is present, and provider tabs hide according to availability.
- Unit/component: selected work item/branch renders a removable compact pill/state.
- Main-process existing tests for `first-work-branch-rename.ts` should stay green; add a regression only if renderer create behavior changes branch/display seed assumptions.
- UI verification: desktop and mobile screenshots of default modal, picker open from issue icon, picker open from branch icon, custom-name tooltip, selected-source pill, and SSH disconnected gate.

## Rollout

1. Change settings default to auto-name on for new installs/settings resets.
2. Refactor composer state so selected source and manual name are independent.
3. Replace default modal source/name field with the compact optional icon row.
4. Convert source picker visible copy from `Smart` to `All` and add top search.
5. Wire issue and branch icons to the same picker.
6. Verify SSH/provider gates and mobile layout.
7. Run targeted unit/component tests, typecheck, and UI screenshot verification.
