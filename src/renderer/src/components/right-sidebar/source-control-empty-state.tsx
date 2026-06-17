import type { ReactNode } from 'react'

export function SourceControlEmptyState({
  heading,
  supportingText,
  action
}: {
  heading: string
  supportingText: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-medium text-foreground">{heading}</div>
      <div className="mt-1.5 max-w-[15rem] text-xs leading-relaxed text-muted-foreground">
        {supportingText}
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
