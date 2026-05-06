import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Wrench } from 'lucide-react'
import type { CustomAgentProfile, TuiAgent } from '../../../../shared/types'
import { AGENT_CATALOG, AgentIcon } from '@/lib/agent-catalog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'

type CustomAgentsSectionProps = {
  customAgents: CustomAgentProfile[]
  onChange: (next: CustomAgentProfile[]) => void
  /** Default-agent control — surfaces a "Set as default" affordance per
   *  profile so the user can wire a custom agent into the auto-pick flow. */
  defaultCustomAgentId: string | null
  onSetDefault: (id: string) => void
  /** Why: shell-quoting for env values is POSIX-shaped. Surface a hint on
   *  Windows so users don't paste an env map and silently get a no-op. */
  isWindows: boolean
}

type DraftRow = Omit<CustomAgentProfile, 'env'> & {
  envPairs: { key: string; value: string }[]
}

function profileToDraft(profile: CustomAgentProfile): DraftRow {
  return {
    id: profile.id,
    label: profile.label,
    baseAgent: profile.baseAgent,
    command: profile.command,
    envPairs: Object.entries(profile.env ?? {}).map(([key, value]) => ({ key, value }))
  }
}

function draftToProfile(draft: DraftRow): CustomAgentProfile | null {
  const label = draft.label.trim()
  const command = draft.command.trim()
  if (!label || !command) {
    return null
  }
  const env: Record<string, string> = {}
  for (const pair of draft.envPairs) {
    const key = pair.key.trim()
    if (!key) {
      continue
    }
    env[key] = pair.value
  }
  const profile: CustomAgentProfile = {
    id: draft.id,
    label,
    baseAgent: draft.baseAgent,
    command
  }
  if (Object.keys(env).length > 0) {
    profile.env = env
  }
  return profile
}

function newDraftFor(baseAgent: TuiAgent): DraftRow {
  const id = globalThis.crypto.randomUUID()
  const entry = AGENT_CATALOG.find((a) => a.id === baseAgent)
  return {
    id,
    label: '',
    baseAgent,
    command: entry?.cmd ?? baseAgent,
    envPairs: [{ key: '', value: '' }]
  }
}

export function CustomAgentsSection({
  customAgents,
  onChange,
  defaultCustomAgentId,
  onSetDefault,
  isWindows
}: CustomAgentsSectionProps): React.JSX.Element {
  // Why: edits live in local draft state per-row so users can experiment with
  // env keys/values without each keystroke writing to global settings (and
  // racing with re-renders that would scroll the field out from under them).
  // Drafts commit on blur or Save click.
  const [drafts, setDrafts] = useState<DraftRow[]>(() => customAgents.map(profileToDraft))
  const [editingId, setEditingId] = useState<string | null>(null)
  const lastExternalRef = useRef<CustomAgentProfile[]>(customAgents)

  useEffect(() => {
    // Why: external settings updates (e.g. settings sync, undo) should
    // refresh local drafts unless the user is mid-edit. Reference-equality
    // check skips the trivial case where this component itself wrote.
    if (lastExternalRef.current === customAgents) {
      return
    }
    lastExternalRef.current = customAgents
    if (editingId) {
      // Don't yank focus; merge non-edited rows from external state.
      setDrafts((prev) => {
        const externalById = new Map(customAgents.map((p) => [p.id, p]))
        const next = prev
          .filter((d) => d.id === editingId || externalById.has(d.id))
          .map((d) => {
            if (d.id === editingId) {
              return d
            }
            const ext = externalById.get(d.id)
            return ext ? profileToDraft(ext) : d
          })
        // Append newly-external rows we didn't have locally.
        for (const ext of customAgents) {
          if (!next.find((d) => d.id === ext.id)) {
            next.push(profileToDraft(ext))
          }
        }
        return next
      })
      return
    }
    setDrafts(customAgents.map(profileToDraft))
  }, [customAgents, editingId])

  const commit = (next: DraftRow[]): void => {
    const profiles = next.map(draftToProfile).filter((p): p is CustomAgentProfile => p !== null)
    lastExternalRef.current = profiles
    onChange(profiles)
  }

  const updateDraft = (id: string, patch: Partial<DraftRow>): void => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  const addProfile = (baseAgent: TuiAgent): void => {
    const draft = newDraftFor(baseAgent)
    setDrafts((prev) => [...prev, draft])
    setEditingId(draft.id)
  }

  const removeProfile = (id: string): void => {
    const next = drafts.filter((d) => d.id !== id)
    setDrafts(next)
    if (editingId === id) {
      setEditingId(null)
    }
    commit(next)
  }

  const finishEdit = (id: string): void => {
    setEditingId((cur) => (cur === id ? null : cur))
    commit(drafts)
  }

  const baseAgentOptions = useMemo(
    () => AGENT_CATALOG.map((a) => ({ id: a.id, label: a.label })),
    []
  )

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Custom Agents</h3>
          <p className="text-xs text-muted-foreground">
            Named variants of a built-in agent with their own command and env vars
            {isWindows
              ? ' (env prefix uses POSIX shell quoting; on Windows wrap with `cmd /c …` if needed)'
              : ''}
            .
          </p>
        </div>
        <AddProfileButton onAdd={addProfile} />
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-xs text-muted-foreground">
          No custom agents yet. Click <span className="font-medium">Add</span> to define one — for
          example, a Claude profile pointed at a self-hosted endpoint via{' '}
          <code className="rounded bg-muted/40 px-1 py-0.5 font-mono">ANTHROPIC_BASE_URL</code>.
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const isEditing = editingId === draft.id
            const isDefault = defaultCustomAgentId === draft.id
            return (
              <div
                key={draft.id}
                className={cn(
                  'rounded-xl border bg-card/60 transition-all',
                  isEditing ? 'border-foreground/30' : 'border-border/60'
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60">
                    <AgentIcon agent={draft.baseAgent} size={18} />
                    <Wrench
                      className="absolute -right-1 -bottom-1 size-3 rounded-sm bg-background p-[1px] text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <Input
                        value={draft.label}
                        onChange={(e) => updateDraft(draft.id, { label: e.target.value })}
                        placeholder="e.g. Claude (zai)"
                        className="h-7 text-sm"
                      />
                    ) : (
                      <div className="truncate text-sm font-semibold leading-none">
                        {draft.label || <span className="text-muted-foreground">Unnamed</span>}
                      </div>
                    )}
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {draft.command || <span className="italic">no command</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => onSetDefault(draft.id)}
                        title={isDefault ? 'Default agent' : 'Set as default'}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                          isDefault
                            ? 'bg-foreground/10 text-foreground ring-1 ring-foreground/20'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                        )}
                      >
                        {isDefault ? 'Default' : 'Set default'}
                      </button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => (isEditing ? finishEdit(draft.id) : setEditingId(draft.id))}
                      className="h-7 px-2 text-xs"
                    >
                      {isEditing ? 'Done' : 'Edit'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeProfile(draft.id)}
                      title="Delete profile"
                      className="size-7 text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="space-y-3 border-t border-border/40 px-4 py-3">
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Base agent</span>
                      <select
                        value={draft.baseAgent}
                        onChange={(e) =>
                          updateDraft(draft.id, { baseAgent: e.target.value as TuiAgent })
                        }
                        className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {baseAgentOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Inherits prompt-injection mode, icon, and trust preflight from this built-in
                        agent.
                      </p>
                    </label>

                    <label className="block">
                      <span className="text-xs text-muted-foreground">Command</span>
                      <Input
                        value={draft.command}
                        onChange={(e) => updateDraft(draft.id, { command: e.target.value })}
                        placeholder="claude"
                        spellCheck={false}
                        className="mt-1 h-7 font-mono text-xs"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Shell command used to launch the agent. Env vars below are prepended as a
                        shell prefix (POSIX quoting) before this command.
                      </p>
                    </label>

                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Environment variables</span>
                      <div className="space-y-1.5">
                        {draft.envPairs.map((pair, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Input
                              value={pair.key}
                              onChange={(e) => {
                                const envPairs = [...draft.envPairs]
                                envPairs[idx] = { ...pair, key: e.target.value }
                                updateDraft(draft.id, { envPairs })
                              }}
                              placeholder="KEY"
                              spellCheck={false}
                              className="h-7 flex-1 font-mono text-xs"
                            />
                            <span className="text-xs text-muted-foreground">=</span>
                            <Input
                              value={pair.value}
                              onChange={(e) => {
                                const envPairs = [...draft.envPairs]
                                envPairs[idx] = { ...pair, value: e.target.value }
                                updateDraft(draft.id, { envPairs })
                              }}
                              placeholder="value"
                              spellCheck={false}
                              className="h-7 flex-[2] font-mono text-xs"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                const envPairs = draft.envPairs.filter((_, i) => i !== idx)
                                updateDraft(draft.id, {
                                  envPairs:
                                    envPairs.length === 0 ? [{ key: '', value: '' }] : envPairs
                                })
                              }}
                              title="Remove env var"
                              className="size-7 text-muted-foreground hover:text-foreground"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          updateDraft(draft.id, {
                            envPairs: [...draft.envPairs, { key: '', value: '' }]
                          })
                        }
                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="size-3" /> Add variable
                      </Button>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => finishEdit(draft.id)}
                        disabled={!draft.label.trim() || !draft.command.trim()}
                        className="h-7 text-xs"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AddProfileButton({ onAdd }: { onAdd: (baseAgent: TuiAgent) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="h-8 gap-1.5 text-xs"
      >
        <Plus className="size-3.5" />
        Add
      </Button>
      {open && (
        <div
          // Why: lightweight inline picker to choose the base agent up front
          // (so users don't open an Edit row pre-filled with the wrong one).
          // A full shadcn Popover here would pull more focus management than
          // necessary for a one-click base-agent select.
          className="absolute right-0 top-9 z-30 max-h-72 w-56 overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          {AGENT_CATALOG.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onAdd(agent.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
            >
              <AgentIcon agent={agent.id} size={14} />
              <span>Based on {agent.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
