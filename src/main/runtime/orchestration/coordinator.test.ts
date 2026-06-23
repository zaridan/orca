/* eslint-disable max-lines -- Why: coordinator tests cover dispatch, DAG ordering, escalation, decision gates, concurrency, and stop — splitting by category would scatter shared setup without improving clarity. */
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import {
  Coordinator,
  DISPATCH_STALE_THRESHOLD,
  parseAllowStaleBaseFromSpec,
  worktreeNameForTask,
  type CoordinatorRuntime
} from './coordinator'
import type { WorktreeLineage } from '../../../shared/types'

// Why (F2 #13): the coordinator (main) produces the lineage edge here; Mission
// Control's `selectSpawnedWorktreeIds` (renderer) consumes it. Asserting that
// selector against the coordinator's exact lineage shape lives in the renderer
// test (orchestrator-mission-control-data.test.ts) to respect the main↔renderer
// project boundary — this test proves the producing half: parent === director.

type DriftResult = {
  base: string
  behind: number
  recentSubjects: string[]
} | null

type CreatedWorktree = {
  worktreeId: string
  parentWorktreeId: string
  branch: string
  taskId?: string
  startupAgent?: string
}

function createMockRuntime(): CoordinatorRuntime & {
  sentMessages: { handle: string; text: string }[]
  terminals: { handle: string; worktreeId: string; connected: boolean; writable: boolean }[]
  createdTerminals: string[]
  createdWorktrees: CreatedWorktree[]
  probeDriftCalls: string[]
  probeDriftResult: DriftResult
  setProbeDrift(result: DriftResult): void
  throwProbeDrift: Error | null
} {
  const mock = {
    sentMessages: [] as { handle: string; text: string }[],
    terminals: [] as {
      handle: string
      worktreeId: string
      connected: boolean
      writable: boolean
    }[],
    createdTerminals: [] as string[],
    createdWorktrees: [] as CreatedWorktree[],
    probeDriftCalls: [] as string[],
    probeDriftResult: null as DriftResult,
    throwProbeDrift: null as Error | null,
    setProbeDrift(result: DriftResult): void {
      mock.probeDriftResult = result
    },
    async sendTerminal(handle: string, action: { text?: string }) {
      mock.sentMessages.push({ handle, text: action.text ?? '' })
      return { handle, accepted: true, bytesWritten: 0 }
    },
    async listTerminals() {
      return { terminals: mock.terminals }
    },
    async createTerminal(worktree?: string, opts?: { title?: string }) {
      const handle = `term_worker_${mock.createdTerminals.length}`
      mock.createdTerminals.push(handle)
      // Why: in worktree-backed tests createTerminal is called with an
      // `id:<worktreeId>` selector; reflect that worktree so the terminal lands
      // in the right checkout. Falls back to 'wt1' for the legacy path.
      const worktreeId = worktree?.replace(/^id:/, '') ?? 'wt1'
      mock.terminals.push({ handle, worktreeId, connected: true, writable: true })
      return { handle, worktreeId, title: opts?.title ?? '' }
    },
    async waitForTerminal(handle: string) {
      return { handle, condition: 'exit' }
    },
    async probeWorktreeDrift(worktreeSelector: string): Promise<DriftResult> {
      mock.probeDriftCalls.push(worktreeSelector)
      if (mock.throwProbeDrift) {
        throw mock.throwProbeDrift
      }
      return mock.probeDriftResult
    },
    // Why (F2 #13): records the lineage parent the coordinator requested and
    // hands back a terminal in the new child worktree, mirroring the real
    // OrcaRuntimeService.createWorktree adapter contract.
    async createWorktree(opts: {
      parentWorktree: string
      name: string
      taskId?: string
      startup?: { agent: string }
    }): Promise<{ worktreeId: string; branch: string; terminalHandle?: string }> {
      const idx = mock.createdWorktrees.length
      const worktreeId = `wt_child_${idx}`
      const parentWorktreeId = opts.parentWorktree.replace(/^id:/, '')
      const handle = `term_wt_${idx}`
      mock.createdWorktrees.push({
        worktreeId,
        parentWorktreeId,
        branch: opts.name,
        taskId: opts.taskId,
        ...(opts.startup ? { startupAgent: opts.startup.agent } : {})
      })
      mock.terminals.push({ handle, worktreeId, connected: true, writable: true })
      return { worktreeId, branch: opts.name, terminalHandle: handle }
    }
  }
  return mock
}

// Why (F2 #13): build the renderer's `worktreeLineageById` map from what the
// mock recorded, so the test exercises the SAME selectSpawnedWorktreeIds path
// Mission Control uses to discover a director's workers.
function lineageMapFromCreated(created: CreatedWorktree[]): Record<string, WorktreeLineage> {
  return Object.fromEntries(
    created.map((wt, i) => [
      wt.worktreeId,
      {
        worktreeId: wt.worktreeId,
        worktreeInstanceId: `${wt.worktreeId}-inst`,
        parentWorktreeId: wt.parentWorktreeId,
        parentWorktreeInstanceId: `${wt.parentWorktreeId}-inst`,
        origin: 'orchestration',
        capture: { source: 'orchestration-context', confidence: 'explicit' },
        createdAt: i
      } satisfies WorktreeLineage
    ])
  )
}

function insertWorkerDone(
  db: OrchestrationDb,
  params: {
    taskId: string
    to?: string
    from?: string
    dispatchId?: string
    filesModified?: string[]
  }
): void {
  const dispatch = db.getDispatchContext(params.taskId)
  const dispatchId = params.dispatchId ?? dispatch?.id
  if (!dispatchId) {
    throw new Error(`No dispatch for task ${params.taskId}`)
  }
  db.insertMessage({
    from: params.from ?? dispatch?.assignee_handle ?? 'term_unknown',
    to: params.to ?? 'coord',
    subject: 'Done',
    type: 'worker_done',
    payload: JSON.stringify({
      taskId: params.taskId,
      dispatchId,
      ...(params.filesModified ? { filesModified: params.filesModified } : {})
    })
  })
}

describe('Coordinator', () => {
  let db: OrchestrationDb

  afterEach(() => {
    db?.close()
  })

  it('throws if no tasks exist', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const coordinator = new Coordinator(db, runtime, {
      spec: 'do stuff',
      coordinatorHandle: 'coord'
    })
    await expect(coordinator.run()).rejects.toThrow('No tasks found')
  })

  it('dispatches a ready task to an available terminal', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'implement feature' })

    // Simulate worker_done arriving after dispatch
    const coordinator = new Coordinator(db, runtime, {
      spec: 'build it',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    // Run coordinator in background, then simulate completion
    const runPromise = coordinator.run()

    // Wait for dispatch to happen
    await new Promise((r) => {
      setTimeout(r, 100)
    })

    // Simulate the worker completing
    insertWorkerDone(db, { taskId: task.id, filesModified: ['a.ts'] })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(task.id)
    expect(runtime.sentMessages.length).toBeGreaterThan(0)
  })

  it('creates a terminal when none are available', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()

    const task = db.createTask({ spec: 'work' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    await new Promise((r) => {
      setTimeout(r, 100)
    })

    expect(runtime.createdTerminals.length).toBe(1)

    // Complete the task
    insertWorkerDone(db, { taskId: task.id, from: runtime.createdTerminals[0] })

    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('handles escalation and circuit breaker', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [
      { handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_b', worktreeId: 'wt1', connected: true, writable: true }
    ]

    const task = db.createTask({ spec: 'risky work' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Send 3 escalations to trigger circuit breaker
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => {
        setTimeout(r, 100)
      })
      db.insertMessage({
        from: `term_${i === 0 ? 'a' : 'b'}`,
        to: 'coord',
        subject: `Failed attempt ${i + 1}`,
        type: 'escalation',
        payload: JSON.stringify({ taskId: task.id })
      })
    }

    const result = await runPromise
    expect(result.status).toBe('failed')
    expect(result.failedTasks).toContain(task.id)
  })

  it('reports failed when dispatch send failures circuit-break in the DB', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
    runtime.sendTerminal = async () => {
      throw new Error('terminal_not_writable')
    }

    const task = db.createTask({ spec: 'cannot dispatch' })
    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 10
    })

    const result = await coordinator.run()

    expect(result.status).toBe('failed')
    expect(result.failedTasks).toContain(task.id)
    expect(db.getTask(task.id)?.status).toBe('failed')
  })

  it('handles decision gate blocking and resolution', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'needs approval' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Wait for dispatch
    await new Promise((r) => {
      setTimeout(r, 100)
    })

    // Worker sends decision gate
    db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'Need approval',
      type: 'decision_gate',
      payload: JSON.stringify({
        taskId: task.id,
        question: 'Proceed with destructive migration?',
        options: ['yes', 'no']
      })
    })

    await new Promise((r) => {
      setTimeout(r, 100)
    })

    // Verify task is blocked
    const blocked = db.getTask(task.id)
    expect(blocked?.status).toBe('blocked')
    expect(db.getActiveDispatchForTerminal('term_a')).toBeUndefined()

    // Resolve the gate
    const gates = db.listGates({ taskId: task.id, status: 'pending' })
    expect(gates.length).toBe(1)
    db.resolveGate(gates[0].id, 'yes')

    // Wait for re-dispatch and simulate completion
    await new Promise((r) => {
      setTimeout(r, 200)
    })

    insertWorkerDone(db, { taskId: task.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(task.id)
  })

  it('respects task DAG ordering', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const t1 = db.createTask({ spec: 'first' })
    const t2 = db.createTask({ spec: 'second', deps: [t1.id] })

    expect(t2.status).toBe('pending')

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    // Wait for t1 dispatch
    await new Promise((r) => {
      setTimeout(r, 100)
    })

    // t2 should still be pending
    expect(db.getTask(t2.id)?.status).toBe('pending')

    // Complete t1
    insertWorkerDone(db, { taskId: t1.id })

    // Wait for t2 to be promoted and dispatched
    await new Promise((r) => {
      setTimeout(r, 200)
    })

    // t2 should now be dispatched
    const t2Status = db.getTask(t2.id)?.status
    expect(t2Status === 'dispatched' || t2Status === 'ready').toBe(true)

    // Complete t2
    insertWorkerDone(db, { taskId: t2.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
    expect(result.completedTasks).toContain(t1.id)
    expect(result.completedTasks).toContain(t2.id)
  })

  it('respects maxConcurrent limit', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [
      { handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_b', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_c', worktreeId: 'wt1', connected: true, writable: true }
    ]

    const t1 = db.createTask({ spec: 'one' })
    const t2 = db.createTask({ spec: 'two' })
    const t3 = db.createTask({ spec: 'three' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50,
      maxConcurrent: 2
    })

    const runPromise = coordinator.run()

    await new Promise((r) => {
      setTimeout(r, 100)
    })

    // Only 2 should be dispatched
    const dispatched = db.listTasks({ status: 'dispatched' })
    expect(dispatched.length).toBe(2)

    // Complete all tasks
    for (const task of [t1, t2, t3]) {
      insertWorkerDone(db, { taskId: task.id })
      await new Promise((r) => {
        setTimeout(r, 100)
      })
    }

    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('logs a stale warning for dispatched rows past the threshold and does not auto-fail', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    // No terminals available so dispatchReadyTasks creates one and we can
    // drive the stale-scan deterministically via SQL backdating.
    const task = db.createTask({ spec: 'work' })
    const ctx = db.createDispatchContext(task.id, 'term_stale')

    // Backdate dispatched_at and last_heartbeat_at beyond the 10-min threshold
    // so getStaleDispatches returns this row on the first tick.
    const sqlite = (
      db as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }
    ).db
    const iso = (ms: number) => new Date(Date.now() - ms).toISOString()
    sqlite
      .prepare('UPDATE dispatch_contexts SET dispatched_at = ?, last_heartbeat_at = ? WHERE id = ?')
      .run(iso(60 * 60 * 1000), iso(30 * 60 * 1000), ctx.id)

    const logs: string[] = []
    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })

    // Drive one tick then stop — we only need the stale warning to have fired.
    const runPromise = coordinator.run()
    await new Promise((r) => {
      setTimeout(r, 80)
    })
    coordinator.stop()
    await runPromise

    expect(logs.some((l) => /has not sent a heartbeat/.test(l) && l.includes(task.id))).toBe(true)
    // Task status must NOT have been auto-failed — logging only.
    expect(db.getTask(task.id)?.status).toBe('dispatched')
  })

  it('records heartbeat by dispatchId on worker heartbeat messages', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]

    const task = db.createTask({ spec: 'work' })
    const ctx = db.createDispatchContext(task.id, 'term_a')

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })

    const runPromise = coordinator.run()

    db.insertMessage({
      from: 'term_a',
      to: 'coord',
      subject: 'alive',
      type: 'heartbeat',
      payload: JSON.stringify({ taskId: task.id, dispatchId: ctx.id, phase: 'implementing' })
    })

    await new Promise((r) => {
      setTimeout(r, 80)
    })

    expect(db.getDispatchContext(task.id)?.last_heartbeat_at).toBeTruthy()

    // Complete the task so the coordinator run finishes cleanly.
    insertWorkerDone(db, { taskId: task.id })

    const result = await runPromise
    expect(result.status).toBe('completed')
  })

  it('ignores stale worker_done from a failed retry before accepting the active dispatch', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const logs: string[] = []

    const task = db.createTask({ spec: 'retry-sensitive work' })
    const staleCtx = db.createDispatchContext(task.id, 'term_old')
    db.failDispatch(staleCtx.id, 'retry elsewhere')
    const activeCtx = db.createDispatchContext(task.id, 'term_current')

    db.insertMessage({
      from: 'term_old',
      to: 'coord',
      subject: 'Late done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: staleCtx.id })
    })

    const staleCoordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })
    const staleRun = staleCoordinator.run()
    await new Promise((r) => {
      setTimeout(r, 80)
    })
    staleCoordinator.stop()
    await staleRun

    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(staleCtx.id)?.status).toBe('failed')
    expect(db.getDispatchContextById(activeCtx.id)?.status).toBe('dispatched')
    expect(logs.some((m) => m.includes('inactive dispatch'))).toBe(true)

    insertWorkerDone(db, {
      taskId: task.id,
      from: 'term_current',
      dispatchId: activeCtx.id
    })
    const completionCoordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20
    })
    const result = await completionCoordinator.run()

    expect(result.status).toBe('completed')
    expect(db.getTask(task.id)?.status).toBe('completed')
    expect(db.getDispatchContextById(activeCtx.id)?.status).toBe('completed')
  })

  it('ignores worker_done sent by a terminal that does not own the dispatch', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    const logs: string[] = []

    const task = db.createTask({ spec: 'owned work' })
    const ctx = db.createDispatchContext(task.id, 'term_owner')

    db.insertMessage({
      from: 'term_intruder',
      to: 'coord',
      subject: 'Spoofed done',
      type: 'worker_done',
      payload: JSON.stringify({ taskId: task.id, dispatchId: ctx.id })
    })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 20,
      onLog: (m) => logs.push(m)
    })
    const runPromise = coordinator.run()
    await new Promise((r) => {
      setTimeout(r, 80)
    })
    coordinator.stop()
    await runPromise

    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(ctx.id)?.status).toBe('dispatched')
    expect(logs.some((m) => m.includes('expected term_owner'))).toBe(true)
  })

  it('can be stopped', async () => {
    db = new OrchestrationDb(':memory:')
    const runtime = createMockRuntime()
    db.createTask({ spec: 'never finishes' })

    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 50
    })

    const runPromise = coordinator.run()

    await new Promise((r) => {
      setTimeout(r, 100)
    })
    coordinator.stop()

    const result = await runPromise
    expect(result.status).toBe('failed')
  })

  describe('worktree-backed dispatch (F2 #13)', () => {
    it('creates a lineage-visible child worktree (parent = director) that Mission Control finds', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      const directorWorktreeId = 'director-wt'

      const task = db.createTask({ spec: 'implement the bridge' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'build it',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: directorWorktreeId,
        worktreeBacked: true,
        workerAgent: 'claude'
      })

      const runPromise = coordinator.run()

      // Wait for the worktree to be created + dispatch to happen.
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      // A worktree was created with lineage parent = the director.
      expect(runtime.createdWorktrees).toHaveLength(1)
      const child = runtime.createdWorktrees[0]
      expect(child.parentWorktreeId).toBe(directorWorktreeId)
      expect(child.taskId).toBe(task.id)
      expect(child.startupAgent).toBe('claude')

      // The preamble was dispatched into the child worktree's terminal (no bare
      // terminal in the director was created on this path).
      expect(runtime.createdTerminals).toHaveLength(0)
      expect(runtime.sentMessages.some((m) => m.handle === `term_wt_0`)).toBe(true)

      // The drift pre-flight targeted the NEW track worktree, not the director.
      expect(runtime.probeDriftCalls).toContain(`id:${child.worktreeId}`)
      expect(runtime.probeDriftCalls).not.toContain(directorWorktreeId)

      // The produced lineage edge is exactly what Mission Control keys on
      // (parentWorktreeId === directorWorktreeId). The selectSpawnedWorktreeIds
      // consumer side is asserted in the renderer test against this same shape.
      const lineageById = lineageMapFromCreated(runtime.createdWorktrees)
      expect(lineageById[child.worktreeId].parentWorktreeId).toBe(directorWorktreeId)

      insertWorkerDone(db, { taskId: task.id })
      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(result.completedTasks).toContain(task.id)
    })

    it('default-off path is unchanged: dispatches to a bare terminal, never creates a worktree', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      // A pre-existing idle terminal in the director worktree (legacy flow).
      runtime.terminals = [
        { handle: 'term_a', worktreeId: 'director-wt', connected: true, writable: true }
      ]

      const task = db.createTask({ spec: 'legacy work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'build it',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'director-wt'
        // worktreeBacked omitted → default false
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      // Legacy path: no worktree was created; the existing terminal got the work.
      expect(runtime.createdWorktrees).toHaveLength(0)
      expect(runtime.sentMessages.some((m) => m.handle === 'term_a')).toBe(true)

      insertWorkerDone(db, { taskId: task.id, from: 'term_a' })
      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(result.completedTasks).toContain(task.id)
    })

    it('skips worktree-backed dispatch (no orphan worktrees) when no director worktree is set', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      const logs: string[] = []

      db.createTask({ spec: 'needs a parent' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'build it',
        coordinatorHandle: 'coord',
        pollIntervalMs: 30,
        worktreeBacked: true,
        // worktree (director) deliberately omitted → no lineage parent
        onLog: (m) => logs.push(m)
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 80)
      })
      coordinator.stop()
      await runPromise

      // No parentless worktrees were created; the guard logged and skipped.
      expect(runtime.createdWorktrees).toHaveLength(0)
      expect(logs.some((m) => m.includes('worktree-backed dispatch requires a --worktree'))).toBe(
        true
      )
    })
  })

  describe('stale-base dispatch guard', () => {
    it('threads drift into the preamble when behind > 0 and under threshold', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: 5,
        recentSubjects: ['fix A', 'fix B', 'fix C']
      })

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(runtime.probeDriftCalls).toContain('wt1')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).toContain('--- BASE DRIFT ---')
      expect(sent!.text).toContain('5 commits behind origin/main')
      expect(sent!.text).toContain('fix A')
    })

    it('silently skips dispatch when drift > threshold and allow-stale-base is absent', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: DISPATCH_STALE_THRESHOLD + 10,
        recentSubjects: ['fix A']
      })

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 250)
      })
      coordinator.stop()
      const result = await runPromise

      // Why: silent-skip must NOT burn the circuit-breaker budget. Task must
      // stay in `ready`; failDispatch must NOT be called; sendTerminal must
      // NOT be called; no dispatch context should exist.
      expect(runtime.sentMessages).toHaveLength(0)
      expect(db.getTask(task.id)?.status).toBe('ready')
      expect(db.getDispatchContext(task.id)).toBeUndefined()
      // Coordinator was stopped externally, so overall status is 'failed'
      // because tasks are not complete — but the task itself never dispatched.
      expect(result.status).toBe('failed')
      expect(result.failedTasks).not.toContain(task.id)
    })

    it('proceeds with stripped spec + drift section when allow-stale-base overrides', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift({
        base: 'origin/main',
        behind: 200,
        recentSubjects: ['commit 1', 'commit 2']
      })

      const spec = `Investigate issue #42
allow-stale-base: true`
      const task = db.createTask({ spec })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).toContain('--- BASE DRIFT ---')
      expect(sent!.text).toContain('200 commits behind origin/main')
      // Why (§3.4): stripped spec must not contain the infra flag line.
      expect(sent!.text).toContain('Investigate issue #42')
      expect(sent!.text).not.toContain('allow-stale-base: true')
    })

    it('proceeds without drift section when probeWorktreeDrift returns null', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.setProbeDrift(null)

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent).toBeDefined()
      expect(sent!.text).not.toContain('--- BASE DRIFT ---')
    })

    it('does not call probeWorktreeDrift when coordinator has no worktree selector', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      const logs: string[] = []

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        // worktree deliberately omitted
        onLog: (msg) => logs.push(msg)
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      expect(runtime.probeDriftCalls).toHaveLength(0)
      expect(logs.some((m) => m.includes('stale-base guard inert'))).toBe(true)
      // Dispatch still went through normally.
      expect(runtime.sentMessages.length).toBeGreaterThan(0)
    })

    it('proceeds without drift when probeWorktreeDrift throws', async () => {
      db = new OrchestrationDb(':memory:')
      const runtime = createMockRuntime()
      runtime.terminals = [{ handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true }]
      runtime.throwProbeDrift = new Error('boom')

      const task = db.createTask({ spec: 'do the work' })

      const coordinator = new Coordinator(db, runtime, {
        spec: 'go',
        coordinatorHandle: 'coord',
        pollIntervalMs: 50,
        worktree: 'wt1'
      })

      const runPromise = coordinator.run()
      await new Promise((r) => {
        setTimeout(r, 100)
      })

      insertWorkerDone(db, { taskId: task.id })

      const result = await runPromise
      expect(result.status).toBe('completed')
      const sent = runtime.sentMessages.find((m) => m.handle === 'term_a')
      expect(sent!.text).not.toContain('--- BASE DRIFT ---')
    })
  })
})

describe('worktreeNameForTask', () => {
  it('builds a branch-safe slug from the title with a unique task-id suffix', () => {
    const name = worktreeNameForTask({
      id: 'task_abc123',
      spec: 'ignored',
      task_title: 'Implement the Bridge!'
    })
    expect(name).toBe('orch-implement-the-bridge-abc123')
    expect(name).toMatch(/^[a-z0-9-]+$/)
  })

  it('falls back to the spec first line when there is no title', () => {
    const name = worktreeNameForTask({
      id: 'task_def456',
      spec: 'Fix flaky test\nmore detail here',
      task_title: null
    })
    expect(name).toBe('orch-fix-flaky-test-def456')
  })

  it('uses only the task id when the source has no usable characters', () => {
    const name = worktreeNameForTask({ id: 'task_xyz789', spec: '!!! ???', task_title: null })
    expect(name).toBe('orch-xyz789')
  })
})

describe('parseAllowStaleBaseFromSpec', () => {
  it('matches canonical form on its own line and strips it', () => {
    const spec = `Do the work
allow-stale-base: true`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).toBe('Do the work\n')
    expect(strippedSpec).not.toContain('allow-stale-base')
  })

  it('matches case-insensitively', () => {
    const spec = `Do the work
Allow-Stale-Base: TRUE`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).not.toMatch(/[Aa]llow-[Ss]tale-[Bb]ase/)
  })

  it('does not match allow-stale-base: false', () => {
    const spec = `Do the work
allow-stale-base: false`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('does not match allow-stale-base: truthy', () => {
    const spec = `Do the work
allow-stale-base: truthy`
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('does not match the flag embedded inside a sentence', () => {
    const spec = 'we allow-stale-base: true sometimes'
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(false)
    expect(strippedSpec).toBe(spec)
  })

  it('handles the flag as the last line with no trailing newline', () => {
    const spec = 'line 1\nallow-stale-base: true'
    const { allowStale, strippedSpec } = parseAllowStaleBaseFromSpec(spec)
    expect(allowStale).toBe(true)
    expect(strippedSpec).toBe('line 1\n')
    expect(strippedSpec.endsWith('allow-stale-base: true')).toBe(false)
  })
})
