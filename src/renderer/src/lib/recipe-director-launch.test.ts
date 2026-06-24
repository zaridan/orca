import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../shared/types'

// A mutable harness the mocked modules read, reset per test.
const harness = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  registerOrchestrator: vi.fn(),
  settings: { defaultTuiAgent: 'codex' } as { defaultTuiAgent?: string },
  activate: vi.fn(),
  taskCreate: vi.fn(),
  run: vi.fn(),
  runtimeCall: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(harness), {
    getState: () => ({
      createWorktree: harness.createWorktree,
      registerOrchestrator: harness.registerOrchestrator,
      repos: [],
      settings: harness.settings
    })
  })
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => harness.activate(...args)
}))

// The shell helper is exercised separately; here we stub it so the launch test
// stays focused on the compile → taskCreate → run wiring and the token-free path.
vi.mock('@/lib/director-worktree-shell', () => ({
  createDirectorWorktreeShell: vi.fn(async () => ({ worktreeId: 'wt_director', setup: undefined }))
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => harness.toastError(...args) }
}))

import { launchRecipeDirector } from './recipe-director-launch'
import { IMPLEMENT_THEN_REVIEW } from './recipe-director-recipes'

const PROJECT: Project = {
  id: 'proj_1',
  displayName: 'Demo',
  sourceRepoIds: ['repo_1']
} as unknown as Project

beforeEach(() => {
  vi.clearAllMocks()
  harness.settings = { defaultTuiAgent: 'codex' }
  harness.activate.mockReturnValue({ primaryTabId: 'tab_1' })
  let n = 0
  harness.taskCreate.mockImplementation(async () => ({ task: { id: `task_${++n}` } }))
  harness.run.mockResolvedValue({ runId: 'run_1', status: 'running' })
  harness.runtimeCall.mockResolvedValue({ ok: true, result: { handle: 'coordinator_term' } })
  // window.api wiring
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      orchestration: { taskCreate: harness.taskCreate, run: harness.run },
      runtime: { call: harness.runtimeCall }
    }
  }
})

describe('launchRecipeDirector', () => {
  it('compiles the recipe into ordered taskCreate calls stamped to the shell', async () => {
    const ok = await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)
    expect(ok).toBe(true)

    expect(harness.taskCreate).toHaveBeenCalledTimes(2)
    const [implementCall] = harness.taskCreate.mock.calls[0]
    const [reviewCall] = harness.taskCreate.mock.calls[1]

    // implement: first, no deps, stamped to the director worktree.
    expect(implementCall.taskTitle).toBe('implement')
    expect(implementCall.deps).toBeUndefined()
    expect(implementCall.targetWorktree).toBe('id:wt_director')
    expect(implementCall.spec).toMatch(/^track: \S+/)

    // review: depends on implement's created id, same target.
    expect(reviewCall.taskTitle).toBe('review')
    expect(reviewCall.deps).toBe(JSON.stringify(['task_1']))
    expect(reviewCall.targetWorktree).toBe('id:wt_director')
  })

  it('starts a worktree-backed run anchored on the shell with the default worker agent', async () => {
    await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)

    expect(harness.run).toHaveBeenCalledTimes(1)
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: 'recipe:implement_then_review',
        worktree: 'id:wt_director',
        worktreeBacked: true,
        workerAgent: 'codex',
        from: 'coordinator_term'
      })
    )
    // Tasks are created BEFORE the run starts (so run-start adoption sees them).
    expect(harness.taskCreate.mock.invocationCallOrder[1]).toBeLessThan(
      harness.run.mock.invocationCallOrder[0]
    )
  })

  it('is token-free: never seeds an agent or prompt into the director shell', async () => {
    await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)

    // The shell is activated with NO startup payload — no agent command, no
    // /orcastrate paste. The only agent in the whole flow is the run's workerAgent.
    expect(harness.activate).toHaveBeenCalledTimes(1)
    const [worktreeId, opts] = harness.activate.mock.calls[0]
    expect(worktreeId).toBe('wt_director')
    expect(opts.startup).toBeUndefined()
    expect(opts.issueCommand).toBeUndefined()
    // Programmatic launch reveals the shell without yanking the user's active tab.
    expect(opts.suppressActivation).toBe(true)
  })

  it('falls back to claude when the default agent is a blank shell', async () => {
    harness.settings = { defaultTuiAgent: 'blank' }
    await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)
    expect(harness.run).toHaveBeenCalledWith(expect.objectContaining({ workerAgent: 'claude' }))
  })

  it('still starts the run when the shell terminal handle cannot be resolved', async () => {
    harness.runtimeCall.mockResolvedValue({ ok: false, error: { message: 'no_active_terminal' } })
    const ok = await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)
    expect(ok).toBe(true)
    const [runParams] = harness.run.mock.calls[0]
    expect(runParams.from).toBeUndefined()
    expect(runParams.worktreeBacked).toBe(true)
  })

  it('aborts (no tasks, no run) when the shell cannot be created', async () => {
    const shellModule = await import('@/lib/director-worktree-shell')
    vi.mocked(shellModule.createDirectorWorktreeShell).mockResolvedValueOnce(null)

    const ok = await launchRecipeDirector(PROJECT, IMPLEMENT_THEN_REVIEW)
    expect(ok).toBe(false)
    expect(harness.taskCreate).not.toHaveBeenCalled()
    expect(harness.run).not.toHaveBeenCalled()
  })
})
