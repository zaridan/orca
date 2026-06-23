import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb, CoordinatorRunConflictError } from './db'

// Why: regression suite for issue #12 / Orca bug #4389. Two coordinator runs
// shared one orchestration DB and poached each other's work because the task
// DAG, dispatch contexts, and decision gates were a single global namespace,
// while message inboxes collided on the literal 'coordinator' handle. These
// tests pin the per-run isolation invariants (Approach B: coordinator_run_id
// scoping + per-run handle + atomic run-start). See DECISION.md.
//
// The bug is a *concurrent* clash, so the isolation tests create two runs that
// are both 'running' at once and assert neither sees the other's rows. (Two
// running rows coexist via the plain createCoordinatorRun insert; the RPC path
// serializes starts via startCoordinatorRun — covered separately below.)
describe('orchestration per-run isolation (issue #12)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function createDb(): OrchestrationDb {
    db = new OrchestrationDb(':memory:')
    return db
  }

  function twoConcurrentRuns(d: OrchestrationDb): { runA: string; runB: string } {
    const runA = d.createCoordinatorRun({ spec: 'A', coordinatorHandle: 'coordinator-a' })
    const runB = d.createCoordinatorRun({ spec: 'B', coordinatorHandle: 'coordinator-b' })
    return { runA: runA.id, runB: runB.id }
  }

  it('REPRO: a run must not see the other run tasks via listTasks', () => {
    const d = createDb()
    const { runA, runB } = twoConcurrentRuns(d)

    d.createTask({ spec: 'A-1', coordinatorRunId: runA })
    d.createTask({ spec: 'A-2', coordinatorRunId: runA })
    d.createTask({ spec: 'B-1', coordinatorRunId: runB })

    expect(d.listTasks({ ready: true, coordinatorRunId: runB }).map((t) => t.spec)).toEqual(['B-1'])
    expect(
      d
        .listTasks({ coordinatorRunId: runA })
        .map((t) => t.spec)
        .sort()
    ).toEqual(['A-1', 'A-2'])
  })

  it('REPRO: the dispatch uniqueness guard is scoped per run, not global', () => {
    const d = createDb()
    const { runA, runB } = twoConcurrentRuns(d)
    const taskA = d.createTask({ spec: 'A-1', coordinatorRunId: runA })
    const taskB = d.createTask({ spec: 'B-1', coordinatorRunId: runB })

    d.createDispatchContext(taskA.id, 'worker_shared')
    // Different run, same worker handle: must NOT trip "already working".
    expect(() => d.createDispatchContext(taskB.id, 'worker_shared')).not.toThrow()
    // Same run, same handle, second active dispatch: still rejected.
    const taskA2 = d.createTask({ spec: 'A-2', coordinatorRunId: runA })
    expect(() => d.createDispatchContext(taskA2.id, 'worker_shared')).toThrow(
      /already has an active dispatch/
    )
  })

  it('REPRO: getStaleDispatches / countActiveDispatches are run-scoped', () => {
    const d = createDb()
    const { runA, runB } = twoConcurrentRuns(d)
    const taskA = d.createTask({ spec: 'A-1', coordinatorRunId: runA })
    const taskB = d.createTask({ spec: 'B-1', coordinatorRunId: runB })
    d.createDispatchContext(taskA.id, 'worker_a')
    d.createDispatchContext(taskB.id, 'worker_b')

    expect(d.countActiveDispatches(runA)).toBe(1)
    expect(d.countActiveDispatches(runB)).toBe(1)
    expect(d.countActiveDispatches()).toBe(2)

    // Backdate run A's dispatch far past the grace window; keep run B's fresh.
    // Both use ISO timestamps so the lexicographic compare in getStaleDispatches
    // matches the ISO threshold (SQLite's datetime('now') space-format would
    // sort before any 'T'-delimited ISO string).
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    const sqlite = (
      d as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): void } } }
    ).db
    sqlite
      .prepare("UPDATE dispatch_contexts SET dispatched_at = ? WHERE assignee_handle = 'worker_a'")
      .run(longAgo)
    sqlite
      .prepare("UPDATE dispatch_contexts SET dispatched_at = ? WHERE assignee_handle = 'worker_b'")
      .run(fresh)

    const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(d.getStaleDispatches(threshold, runA).map((c) => c.assignee_handle)).toEqual([
      'worker_a'
    ])
    expect(d.getStaleDispatches(threshold, runB)).toHaveLength(0)
  })

  it('REPRO: listGates({status}) is run-scoped', () => {
    const d = createDb()
    const { runA, runB } = twoConcurrentRuns(d)
    const taskA = d.createTask({ spec: 'A-1', coordinatorRunId: runA })
    const taskB = d.createTask({ spec: 'B-1', coordinatorRunId: runB })
    d.createGate({ taskId: taskA.id, question: 'A?' })
    d.createGate({ taskId: taskB.id, question: 'B?' })

    expect(
      d.listGates({ status: 'pending', coordinatorRunId: runB }).map((g) => g.task_id)
    ).toEqual([taskB.id])
    expect(
      d.listGates({ status: 'pending', coordinatorRunId: runA }).map((g) => g.task_id)
    ).toEqual([taskA.id])
  })

  describe('task adoption', () => {
    it('claims pre-run (unowned) tasks for the starting run', () => {
      const d = createDb()
      const preTask = d.createTask({ spec: 'pre-run' })
      expect(preTask.coordinator_run_id).toBeNull()

      const runA = d.createCoordinatorRun({ spec: 'A', coordinatorHandle: 'coordinator-a' })
      d.adoptUnownedTasks(runA.id)

      expect(d.getTask(preTask.id)?.coordinator_run_id).toBe(runA.id)
    })

    it('never steals a concurrently-running run tasks', () => {
      const d = createDb()
      const { runA, runB } = twoConcurrentRuns(d)
      const ownedByA = d.createTask({ spec: 'A-1', coordinatorRunId: runA })

      d.adoptUnownedTasks(runB)

      // Run A is still running, so its task is untouched (no poaching).
      expect(d.getTask(ownedByA.id)?.coordinator_run_id).toBe(runA)
    })

    it('reclaims tasks left by a run that is no longer running', () => {
      const d = createDb()
      const runA = d.createCoordinatorRun({ spec: 'A', coordinatorHandle: 'coordinator-a' })
      const leftover = d.createTask({ spec: 'A-1', coordinatorRunId: runA.id })
      d.updateCoordinatorRun(runA.id, 'failed')

      const runB = d.createCoordinatorRun({ spec: 'B', coordinatorHandle: 'coordinator-b' })
      d.adoptUnownedTasks(runB.id)

      expect(d.getTask(leftover.id)?.coordinator_run_id).toBe(runB.id)
    })
  })

  describe('atomic run-start (TOCTOU close)', () => {
    it('rejects a second run while one is already running', () => {
      const d = createDb()
      d.startCoordinatorRun({ spec: 'A', coordinatorHandle: 'coordinator-a' })
      expect(() =>
        d.startCoordinatorRun({ spec: 'B', coordinatorHandle: 'coordinator-b' })
      ).toThrow(CoordinatorRunConflictError)
    })

    it('does not leave a dangling transaction after a rejected start', () => {
      const d = createDb()
      const runA = d.startCoordinatorRun({ spec: 'A', coordinatorHandle: 'coordinator-a' })
      expect(() => d.startCoordinatorRun({ spec: 'B', coordinatorHandle: 'b' })).toThrow()
      // The DB is still writable (the failed start rolled back cleanly).
      d.updateCoordinatorRun(runA.id, 'completed')
      const runC = d.startCoordinatorRun({ spec: 'C', coordinatorHandle: 'coordinator-c' })
      expect(runC.status).toBe('running')
    })
  })
})
