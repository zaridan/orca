import { randomBytes } from 'crypto'
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import { CoordinatorRunConflictError, type GateStatus } from '../../orchestration/db'
import { Coordinator } from '../../orchestration/coordinator'

// Why: the coordinator instance is stored at module scope so orchestration.runStop
// can signal it to halt. Only one coordinator can run at a time (enforced
// atomically by the DB's partial unique index on running runs), so a single
// reference suffices.
let activeCoordinator: Coordinator | null = null

// Why (#12): each run gets a unique coordinator handle instead of the literal
// 'coordinator' default, so two runs' message inboxes can't collide and one
// run can't markAsRead another's worker_done/heartbeat (a silent-hang clash).
function deriveCoordinatorHandle(): string {
  return `coordinator-${randomBytes(3).toString('hex')}`
}

const RunParams = z.object({
  spec: requiredString('Missing --spec'),
  from: OptionalString,
  pollIntervalMs: OptionalFiniteNumber,
  maxConcurrent: OptionalFiniteNumber,
  worktree: OptionalString
})

const RunStopParams = z.object({})

const GateCreateParams = z.object({
  task: requiredString('Missing --task'),
  question: requiredString('Missing --question'),
  options: OptionalString
})

const GateResolveParams = z.object({
  id: requiredString('Missing --id'),
  resolution: requiredString('Missing --resolution')
})

const GateListParams = z.object({
  task: OptionalString,
  status: z.enum(['pending', 'resolved', 'timeout']).optional()
})

export const ORCHESTRATION_GATE_METHODS: RpcMethod[] = [
  // Why: Section 4.12 — orchestration.run returns immediately with a run ID.
  // The coordinator loop runs in the background; progress is queried via
  // orchestration.taskList. This prevents the RPC call from blocking the
  // CLI (or any caller) for the entire duration of the pipeline.
  defineMethod({
    name: 'orchestration.run',
    params: RunParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()

      const coordinatorHandle = params.from ?? deriveCoordinatorHandle()

      // Why (#12): atomic check+insert (BEGIN IMMEDIATE inside startCoordinatorRun)
      // closes the TOCTOU between "is a run active?" and "insert a running run"
      // that let two runtimes sharing one DB both start a coordinator.
      let run
      try {
        run = db.startCoordinatorRun({
          spec: params.spec,
          coordinatorHandle,
          pollIntervalMs: params.pollIntervalMs
        })
      } catch (err) {
        if (err instanceof CoordinatorRunConflictError) {
          throw new Error(err.message)
        }
        throw err
      }

      const coordinator = new Coordinator(db, runtime, {
        spec: params.spec,
        coordinatorHandle,
        pollIntervalMs: params.pollIntervalMs,
        maxConcurrent: params.maxConcurrent,
        worktree: params.worktree
      })

      activeCoordinator = coordinator

      // Why: fire-and-forget — the coordinator loop runs in the event loop
      // background. Results are persisted to the DB; callers query via
      // orchestration.taskList or orchestration.runStatus.
      coordinator.runFromExistingRun(run.id).finally(() => {
        if (activeCoordinator === coordinator) {
          activeCoordinator = null
        }
      })

      return { runId: run.id, status: 'running' }
    }
  }),

  defineMethod({
    name: 'orchestration.runStop',
    params: RunStopParams,
    handler: (_params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const run = db.getActiveCoordinatorRun()
      if (!run) {
        throw new Error('No active coordinator run')
      }

      if (activeCoordinator) {
        activeCoordinator.stop()
        activeCoordinator = null
      }

      return { runId: run.id, stopped: true }
    }
  }),

  defineMethod({
    name: 'orchestration.gateCreate',
    params: GateCreateParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      let options: string[] | undefined
      if (params.options) {
        try {
          const parsed = JSON.parse(params.options)
          if (!Array.isArray(parsed) || !parsed.every((option) => typeof option === 'string')) {
            throw new Error('not an array of strings')
          }
          options = parsed
        } catch {
          throw new Error('Invalid --options: must be a JSON array of strings')
        }
      }
      const gate = db.createGate({
        taskId: params.task,
        question: params.question,
        options
      })
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateResolve',
    params: GateResolveParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const gate = db.resolveGate(params.id, params.resolution)
      if (!gate) {
        throw new Error(`Gate not found: ${params.id}`)
      }
      return { gate }
    }
  }),

  defineMethod({
    name: 'orchestration.gateList',
    params: GateListParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      const gates = db.listGates({
        taskId: params.task,
        status: params.status as GateStatus
      })
      return { gates, count: gates.length }
    }
  })
]
