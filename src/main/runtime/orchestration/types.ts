export type MessageType =
  | 'status'
  | 'dispatch'
  | 'worker_done'
  | 'merge_ready'
  | 'escalation'
  | 'handoff'
  | 'decision_gate'
  | 'heartbeat'

export type MessagePriority = 'normal' | 'high' | 'urgent'

export type TaskStatus = 'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'

export type DispatchStatus = 'pending' | 'dispatched' | 'completed' | 'failed' | 'circuit_broken'

export type GateStatus = 'pending' | 'resolved' | 'timeout'

export type CoordinatorStatus = 'idle' | 'running' | 'completed' | 'failed'

export type MessageRow = {
  id: string
  from_handle: string
  to_handle: string
  subject: string
  body: string
  type: MessageType
  priority: MessagePriority
  thread_id: string | null
  payload: string | null
  read: number
  sequence: number
  created_at: string
  delivered_at: string | null
}

export type TaskRow = {
  id: string
  parent_id: string | null
  created_by_terminal_handle: string | null
  // Why (#12): scopes the task to a coordinator run so two runs sharing the DB
  // can't see or dispatch each other's tasks. NULL until a run adopts it
  // (tasks are created before `orchestration.run`, so they start unowned).
  coordinator_run_id: string | null
  task_title: string | null
  display_name: string | null
  spec: string
  status: TaskStatus
  deps: string
  result: string | null
  created_at: string
  completed_at: string | null
}

export type DispatchContextRow = {
  id: string
  task_id: string
  // Why (#12): copied from the dispatched task so dispatch queries (uniqueness
  // guard, stale/active counts) stay scoped to one run.
  coordinator_run_id: string | null
  assignee_handle: string | null
  status: DispatchStatus
  failure_count: number
  last_failure: string | null
  dispatched_at: string | null
  completed_at: string | null
  created_at: string
  last_heartbeat_at: string | null
}

export type DecisionGateRow = {
  id: string
  task_id: string
  // Why (#12): copied from the gated task so listGates({status}) stays scoped
  // to one run.
  coordinator_run_id: string | null
  question: string
  options: string
  status: GateStatus
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export type CoordinatorRun = {
  id: string
  spec: string
  status: CoordinatorStatus
  coordinator_handle: string
  poll_interval_ms: number
  // Why (#12): identifies the run's repo/worktree so the run-start guard rejects
  // only a duplicate run on the same target, not all concurrency. NULL when no
  // worktree was given at run-start (those runs share a single-run slot).
  target_key: string | null
  created_at: string
  completed_at: string | null
}
