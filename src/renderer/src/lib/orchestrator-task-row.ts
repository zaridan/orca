import type { AgentDotState } from '@/components/AgentStateDot'
import type { OrchestrationRunDag, OrchestrationTaskNode } from '../../../shared/runtime-types'

// Why (#7 O2): map a task node's DB status (+ dispatch liveness) onto the shared
// AgentStateDot vocabulary so the Control Panel reuses the same status visuals as
// the rest of the app instead of inventing new ones. Mirrors the field mapping in
// issue #7: pending/ready=idle, dispatched=working (stalled when the heartbeat is
// past the hung threshold), blocked=blocked, completed=done, failed=interrupted.
export function deriveTaskDotState(node: OrchestrationTaskNode): AgentDotState {
  switch (node.status) {
    case 'pending':
    case 'ready':
      return 'idle'
    case 'dispatched':
      return node.dispatch?.stale ? 'stalled' : 'working'
    case 'blocked':
      return 'blocked'
    case 'completed':
      return 'done'
    case 'failed':
      return 'interrupted'
  }
}

// Why: a short word beside the dot so the row is legible without decoding the
// glyph — matches the storyboard mock ("working" / "queued" / "done").
export function deriveTaskStatusLabel(node: OrchestrationTaskNode): string {
  switch (node.status) {
    case 'pending':
    case 'ready':
      return 'queued'
    case 'dispatched':
      return node.dispatch?.stale ? 'stalled' : 'working'
    case 'blocked':
      return 'blocked'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
  }
}

/** The first dependency that is not yet completed, by title (falling back to id)
 *  — what a queued/blocked task is waiting on. */
function firstUnmetDepTitle(
  node: OrchestrationTaskNode,
  nodesById: Map<string, OrchestrationTaskNode>
): string | null {
  for (const depId of node.deps) {
    const dep = nodesById.get(depId)
    if (!dep || dep.status !== 'completed') {
      return dep?.title ?? depId
    }
  }
  return null
}

// Why: the row's message prefers a live signal (latest heartbeat phase or the
// worker_done summary). Absent a signal, a not-yet-running task explains itself
// as waiting on its first unmet dependency. Returns '' when there is nothing
// meaningful to say (e.g. a done task with no recorded summary).
export function deriveTaskMessage(
  node: OrchestrationTaskNode,
  nodesById: Map<string, OrchestrationTaskNode>
): string {
  if (node.signal?.summary) {
    return node.signal.summary
  }
  if (node.signal?.phase) {
    return node.signal.phase
  }
  if (node.status === 'pending' || node.status === 'blocked') {
    const dep = firstUnmetDepTitle(node, nodesById)
    if (dep) {
      return `waiting on ${dep}`
    }
  }
  return ''
}

export function indexTaskNodes(dag: OrchestrationRunDag): Map<string, OrchestrationTaskNode> {
  return new Map(dag.tasks.map((task) => [task.id, task]))
}
