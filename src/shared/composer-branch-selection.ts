export type ComposerBranchSelection = {
  baseBranch: string
}

export function resolveComposerBranchSelection(args: {
  refName: string
  localBranchName?: string
}): ComposerBranchSelection {
  return {
    baseBranch: args.refName
  }
}
