import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

type SourceControlCreatePrNoticeValue = {
  message: string
  tone: 'muted' | 'destructive'
  action?: 'settings'
}

export function SourceControlCreatePrNotice({
  notice,
  onOpenSourceControlAiSettings
}: {
  notice: SourceControlCreatePrNoticeValue
  onOpenSourceControlAiSettings?: () => void
}): React.JSX.Element {
  return (
    <div className="px-3 pb-2">
      <div
        role={notice.tone === 'destructive' ? 'alert' : 'status'}
        aria-live="polite"
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[11px]',
          notice.tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        <span className="min-w-0 flex-1">{notice.message}</span>
        {notice.action === 'settings' && onOpenSourceControlAiSettings ? (
          <button
            type="button"
            className="shrink-0 font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
            onClick={() => onOpenSourceControlAiSettings()}
          >
            {translate(
              'auto.components.right.sidebar.SourceControl.473f18758e',
              'Source Control AI settings'
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}
