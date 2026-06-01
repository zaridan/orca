export type FeatureWallSetupStepId =
  | 'default-agent'
  | 'add-two-repos'
  | 'notifications'
  | 'split-terminal'
  | 'two-worktrees'
  | 'task-sources'
  | 'agent-capabilities'
  | 'setup-script'

export type FeatureWallSetupStep = {
  readonly id: FeatureWallSetupStepId
  readonly name: string
  readonly subtitle: string
  readonly description: string
}

export const FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS = [
  'split-terminal',
  'two-worktrees'
] as const satisfies readonly FeatureWallSetupStepId[]

export type FeatureWallSetupSectionId = 'parallel-work' | 'setup'

export const FEATURE_WALL_SETUP_STEPS: readonly FeatureWallSetupStep[] = [
  {
    id: 'split-terminal',
    name: 'Run two things at once',
    subtitle: 'Run two things at once',
    description: 'Keep an agent, dev server, or REPL visible side by side in one workspace.'
  },
  {
    id: 'two-worktrees',
    name: 'Work on a second branch',
    subtitle: 'Work on a second branch',
    description: 'Let agents tackle separate changes in separate worktrees without stepping on each other.'
  },
  {
    id: 'notifications',
    name: 'Turn on notifications',
    subtitle: 'Turn on notifications',
    description: 'Know the moment an agent finishes, needs attention, or gets blocked.'
  },
  {
    id: 'default-agent',
    name: 'Choose your default agent',
    subtitle: 'Choose your default agent',
    description: 'Start new work faster with your preferred agent already selected.'
  },
  {
    id: 'task-sources',
    name: 'Connect integrations',
    subtitle: 'Connect integrations',
    description: 'Start an agent from a task in one click and keep PR status in view.'
  },
  {
    id: 'setup-script',
    name: 'Automate workspace setup',
    subtitle: 'Automate workspace setup',
    description:
      'Run install and setup commands automatically so every new worktree is ready for agents.'
  },
  {
    id: 'add-two-repos',
    name: 'Add your projects',
    subtitle: 'Add your projects',
    description: 'Bring your key repos into Orca so you can start agent work without hunting for folders.'
  },
  {
    id: 'agent-capabilities',
    name: 'Unlock agent actions',
    subtitle: 'Unlock agent actions',
    description: 'Let agents use the browser, computer, and orchestration tools when a task needs it.'
  }
] as const

export const FEATURE_WALL_SETUP_STEP_IDS = FEATURE_WALL_SETUP_STEPS.map((step) => step.id)

export function getFeatureWallSetupSteps(): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS
}

export function getFeatureWallSetupSectionId(
  stepId: FeatureWallSetupStepId
): FeatureWallSetupSectionId {
  return FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS.includes(
    stepId as (typeof FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS)[number]
  )
    ? 'parallel-work'
    : 'setup'
}

export function getFeatureWallSetupStepsForSection(
  sectionId: FeatureWallSetupSectionId
): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS.filter(
    (step) => getFeatureWallSetupSectionId(step.id) === sectionId
  )
}

export function getFirstIncompleteFeatureWallSetupStepId(
  stepDone: Partial<Record<FeatureWallSetupStepId, boolean>>
): FeatureWallSetupStepId {
  const parallelStep = getFeatureWallSetupStepsForSection('parallel-work').find(
    (step) => !stepDone[step.id]
  )
  if (parallelStep) {
    return parallelStep.id
  }
  const setupStep = getFeatureWallSetupStepsForSection('setup').find((step) => !stepDone[step.id])
  return setupStep?.id ?? FEATURE_WALL_SETUP_STEPS[0].id
}
