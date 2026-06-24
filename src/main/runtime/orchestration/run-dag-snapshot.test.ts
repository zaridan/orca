import { describe, expect, it } from 'vitest'
import type { MessageRow } from './types'
import {
  buildRunDagSnapshot,
  indexLatestWorkerSignals,
  type TaskWithDispatchRow
} from './run-dag-snapshot'

const STALE_THRESHOLD = '2026-01-01T00:00:00.000Z'

function taskRow(overrides: Partial<TaskWithDispatchRow>): TaskWithDispatchRow {
  return {
    id: 'task_1',
    parent_id: null,
    created_by_terminal_handle: null,
    coordinator_run_id: 'run_1',
    target_key: 'repo:/x',
    task_title: 'Implement auth',
    display_name: null,
    spec: 'Implement auth',
    status: 'ready',
    deps: '[]',
    result: null,
    created_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    assignee_handle: null,
    dispatch_id: null,
    dispatch_status: null,
    dispatch_last_heartbeat_at: null,
    ...overrides
  }
}

function message(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: 'msg_1',
    from_handle: 'term_worker',
    to_handle: 'term_coord',
    subject: '',
    body: '',
    type: 'heartbeat',
    priority: 'normal',
    thread_id: null,
    payload: null,
    read: 0,
    sequence: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    delivered_at: null,
    ...overrides
  }
}

describe('indexLatestWorkerSignals', () => {
  it('keeps the latest signal per dispatch (messages newest-first)', () => {
    // Newest-first ordering (sequence DESC), as getAllMessagesForHandle returns.
    const signals = indexLatestWorkerSignals([
      message({
        sequence: 3,
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId: 'ctx_1', phase: 'reviewing' })
      }),
      message({
        sequence: 2,
        type: 'heartbeat',
        payload: JSON.stringify({ dispatchId: 'ctx_1', phase: 'implementing' })
      })
    ])
    expect(signals.get('ctx_1')).toEqual({ phase: 'reviewing', summary: null })
  })

  it('captures a worker_done summary from the subject', () => {
    const signals = indexLatestWorkerSignals([
      message({
        type: 'worker_done',
        subject: 'Done: token refresh',
        body: 'Implemented refresh. Tests pass. Nothing left.',
        payload: JSON.stringify({ dispatchId: 'ctx_2', taskId: 'task_2' })
      })
    ])
    expect(signals.get('ctx_2')).toEqual({ phase: null, summary: 'Done: token refresh' })
  })

  it('ignores messages without a dispatchId', () => {
    const signals = indexLatestWorkerSignals([
      message({ type: 'heartbeat', payload: JSON.stringify({ phase: 'x' }) }),
      message({ type: 'heartbeat', payload: 'not json' })
    ])
    expect(signals.size).toBe(0)
  })
})

describe('buildRunDagSnapshot', () => {
  const resolveAgent = (handle: string): 'codex' | 'claude' | null =>
    handle === 'term_codex' ? 'codex' : handle === 'term_claude' ? 'claude' : null

  it('maps a dispatched task with a live heartbeat to a working dispatch', () => {
    const dag = buildRunDagSnapshot({
      runId: 'run_1',
      recipe: null,
      tasks: [
        taskRow({
          id: 'task_a',
          status: 'dispatched',
          assignee_handle: 'term_codex',
          dispatch_id: 'ctx_a',
          dispatch_status: 'dispatched',
          dispatch_last_heartbeat_at: '2026-06-01T00:00:00.000Z' // fresh (> threshold)
        })
      ],
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map([['ctx_a', { phase: 'implementing', summary: null }]]),
      resolveAgent
    })
    expect(dag.tasks).toHaveLength(1)
    const node = dag.tasks[0]!
    expect(node.dispatch).toEqual({
      assigneeHandle: 'term_codex',
      assigneeAgent: 'codex',
      status: 'dispatched',
      lastHeartbeatAt: '2026-06-01T00:00:00.000Z',
      stale: false
    })
    expect(node.signal).toEqual({ phase: 'implementing', summary: null })
  })

  it('flags a dispatched task as stale when its heartbeat predates the threshold', () => {
    const dag = buildRunDagSnapshot({
      runId: 'run_1',
      recipe: null,
      tasks: [
        taskRow({
          status: 'dispatched',
          assignee_handle: 'term_codex',
          dispatch_id: 'ctx_a',
          dispatch_status: 'dispatched',
          dispatch_last_heartbeat_at: '2025-01-01T00:00:00.000Z' // older than threshold
        })
      ],
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map(),
      resolveAgent
    })
    expect(dag.tasks[0]!.dispatch?.stale).toBe(true)
  })

  it('parses deps and leaves a queued task with no dispatch', () => {
    const dag = buildRunDagSnapshot({
      runId: 'run_1',
      recipe: null,
      tasks: [taskRow({ id: 'task_b', status: 'pending', deps: '["task_a"]' })],
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map(),
      resolveAgent
    })
    expect(dag.tasks[0]!.deps).toEqual(['task_a'])
    expect(dag.tasks[0]!.dispatch).toBeNull()
    expect(dag.tasks[0]!.signal).toBeNull()
  })

  it('caps tasks and reports the truncated count', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => taskRow({ id: `task_${i}` }))
    const dag = buildRunDagSnapshot({
      runId: 'run_1',
      recipe: null,
      tasks,
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map(),
      resolveAgent,
      taskCap: 2
    })
    expect(dag.tasks).toHaveLength(2)
    expect(dag.truncatedTaskCount).toBe(3)
  })

  it('passes the recipe through (mode-agnostic: null for LLM directors)', () => {
    const llm = buildRunDagSnapshot({
      runId: 'run_1',
      recipe: null,
      tasks: [],
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map(),
      resolveAgent
    })
    expect(llm.recipe).toBeNull()
    const recipe = buildRunDagSnapshot({
      runId: 'run_2',
      recipe: 'implement_then_review',
      tasks: [],
      staleThresholdIso: STALE_THRESHOLD,
      signalsByDispatchId: new Map(),
      resolveAgent
    })
    expect(recipe.recipe).toBe('implement_then_review')
  })
})
