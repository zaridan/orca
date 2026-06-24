import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { createDirectorWorktreeShell } from '@/lib/director-worktree-shell'
import { translate } from '@/i18n/i18n'
import { compileRecipe, type Recipe } from './recipe-director-recipes'
import type { Project, TuiAgent } from '../../../shared/types'

// Why (#9): the recipe director runs a FIXED recipe with ZERO director LLM tokens.
// It creates the same hidden worktree shell the LLM Orcastrator uses, but leaves it
// agent-free; the merged worktree-backed coordinator then creates per-track child
// worktrees and launches the real WORKER agents (the only LLM cost) — review
// continues implement's branch (one PR) because same-track tasks share a worktree.

// Why: the worker agent does the actual coding, so it must be a real agent (the run
// rejects a worktree-backed run without one). A 'blank' default means "plain shell"
// — fall back to Claude Code, the same resolution the LLM coordinator uses.
function resolveWorkerAgent(defaultTuiAgent: TuiAgent | 'blank' | null | undefined): TuiAgent {
  return defaultTuiAgent && defaultTuiAgent !== 'blank' ? defaultTuiAgent : 'claude'
}

// Why: the run's coordinator inbox AND the live Control Panel key on the director
// pane (getPaneKeyForTerminalHandle(coordinator_handle)). Binding the run's `from`
// to the shell's terminal handle surfaces the DAG under the director and routes
// worker_done/heartbeat to a real inbox.
//
// Opportunistic by design: we do NOT await terminal readiness before resolving the
// active handle (unlike the LLM path, which waits via pasteDraftWhenAgentReady — it
// has an agent to wait for; a blank shell has no readiness signal). On a cold shell
// the resolve can miss, in which case the run derives its own coordinator handle —
// the run still works correctly, the DAG just isn't pane-anchored to the director
// (cosmetic). Pane-anchoring is owned by the #11 picker, which can await readiness.
async function resolveDirectorShellHandle(worktreeSelector: string): Promise<string | undefined> {
  try {
    const response = await window.api.runtime.call({
      method: 'terminal.resolveActive',
      params: { worktree: worktreeSelector }
    })
    if (!response.ok) {
      return undefined
    }
    const handle = (response.result as { handle?: unknown } | null)?.handle
    return typeof handle === 'string' ? handle : undefined
  } catch {
    return undefined
  }
}

export type LaunchRecipeDirectorOptions = {
  /** Human name for the director (shown in the ORCASTRATORS list). */
  name?: string
  /** Worker agent override; defaults to the user's default coding agent. */
  workerAgent?: TuiAgent
}

/**
 * Launch a token-free recipe director for a project. Flow:
 *  1. create the no-LLM director worktree shell (no agent, no prompt);
 *  2. compile the recipe and create one task per recipe task (track hint in the
 *     spec, deps wired key→created id), stamped to the shell worktree so the run
 *     adopts them;
 *  3. start a worktree-backed coordinator run anchored on the shell.
 * The director shell itself runs no agent → no director LLM tokens. The live
 * Control Panel renders the run automatically.
 *
 * GATING: this function is intentionally UNGATED. The `experimentalOrchestrators`
 * gate belongs at the call site — the #11 director-type picker, which does not
 * exist yet. The caller (#11) MUST check `experimentalOrchestrators` before
 * invoking this; do not call it from any always-on UI path.
 */
export async function launchRecipeDirector(
  project: Project,
  recipe: Recipe,
  options?: LaunchRecipeDirectorOptions
): Promise<boolean> {
  const store = useAppStore.getState()
  const settings = store.settings
  const workerAgent = resolveWorkerAgent(options?.workerAgent ?? settings?.defaultTuiAgent)
  const label = options?.name?.trim() || `${project.displayName} · ${recipe.name}`

  // Compile FIRST so a malformed recipe fails before we create any worktree.
  const compiled = compileRecipe(recipe)

  const shell = await createDirectorWorktreeShell(project, { label })
  if (!shell) {
    return false
  }

  // Why: activate WITHOUT any agent startup payload — a blank terminal, no agent,
  // no /orcastrate. This is the token-free invariant: nothing here seeds an LLM
  // into the director shell. It still gives the shell a focusable surface (and a
  // terminal handle for pane-anchoring the run).
  // Why: a recipe director is launched programmatically — reveal it (sidebar +
  // Mission Control DAG) but suppress the active-tab switch so spawning the
  // director does not yank the user off their current worktree.
  const activation = activateAndRevealWorktree(shell.worktreeId, {
    sidebarRevealBehavior: 'auto',
    setup: shell.setup,
    suppressActivation: true
  })
  if (!activation) {
    toast.error(
      translate('auto.lib.orchestrator.launch.no_workspace', 'Could not open the Orcastrator.')
    )
    return false
  }

  store.registerOrchestrator({
    id: shell.worktreeId,
    projectId: project.id,
    projectName: label,
    worktreeId: shell.worktreeId,
    tabId: activation.primaryTabId ?? '',
    launchedAt: Date.now()
  })

  const worktreeSelector = `id:${shell.worktreeId}`

  // Create tasks in dependency order, resolving each recipe-local dependsOn key to
  // the real task id returned by the previous create. targetWorktree stamps the
  // task to the shell so run-start adoptUnownedTasks claims it.
  const idByKey = new Map<string, string>()
  for (const task of compiled) {
    // Why: compileRecipe already topo-sorts and validates deps, so every dependsOn
    // key MUST already be in idByKey. Throw on a miss rather than silently dropping
    // it — a dropped dep would let review go ready before implement and surface far
    // downstream as the coordinator's confusing same-track ordering refusal.
    const depIds = task.dependsOn.map((key) => {
      const id = idByKey.get(key)
      if (id === undefined) {
        throw new Error(
          `Recipe '${recipe.name}' task '${task.key}' depends on unmapped key '${key}'`
        )
      }
      return id
    })
    const { task: created } = await window.api.orchestration.taskCreate({
      spec: task.spec,
      taskTitle: task.key,
      displayName: `${recipe.name}: ${task.key}`,
      deps: depIds.length > 0 ? JSON.stringify(depIds) : undefined,
      targetWorktree: worktreeSelector
    })
    idByKey.set(task.key, created.id)
  }

  const coordinatorHandle = await resolveDirectorShellHandle(worktreeSelector)

  await window.api.orchestration.run({
    spec: `recipe:${recipe.name}`,
    worktree: worktreeSelector,
    worktreeBacked: true,
    workerAgent,
    ...(coordinatorHandle ? { from: coordinatorHandle } : {})
  })

  return true
}
