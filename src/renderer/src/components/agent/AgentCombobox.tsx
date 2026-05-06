import React, { useCallback, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Star, Terminal, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AgentIcon, type AgentCatalogEntry } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import type { CustomAgentProfile, TuiAgent } from '../../../../shared/types'

type DefaultAgentPreference = TuiAgent | 'blank' | { kind: 'custom'; id: string } | null

/** Selection emitted by the combobox. The picker treats blank, built-in, and
 *  custom-profile rows as a tri-state so callers don't have to translate
 *  between two parallel value/onValueChange channels. */
export type AgentSelection =
  | { kind: 'blank' }
  | { kind: 'builtin'; agent: TuiAgent }
  | { kind: 'custom'; profile: CustomAgentProfile }

type AgentComboboxProps = {
  agents: AgentCatalogEntry[]
  customAgents?: CustomAgentProfile[]
  value: AgentSelection
  onValueChange: (selection: AgentSelection) => void
  onValueSelected?: (selection: AgentSelection) => void
  onOpenManageAgents?: () => void
  /** Current saved default agent preference. Used to render a subtle "default"
   *  indicator in the list and to tell which right-click menu item is the
   *  currently-applied choice. */
  defaultAgent?: DefaultAgentPreference
  /** Optional handler for right-click "Set as default" action. When provided,
   *  each list item (including Blank Terminal) gets a context menu. */
  onSetDefault?: (selection: DefaultAgentPreference) => void
  triggerClassName?: string
  /** When set, pressing Enter on the closed combobox trigger invokes this
   *  instead of opening the popover — lets the parent form treat the Agent
   *  field as the last keyboard-submit step. */
  onTriggerEnter?: () => void
}

const BLANK_VALUE = '__none__'

type ItemRenderArgs = {
  key: string
  itemValue: string
  isChecked: boolean
  isDefault: boolean
  onSelect: () => void
  onSetDefault?: () => void
  icon: React.ReactNode
  label: string
}

function renderItem({
  key,
  itemValue,
  isChecked,
  isDefault,
  onSelect,
  onSetDefault,
  icon,
  label
}: ItemRenderArgs): React.ReactNode {
  const row = (
    <CommandItem
      key={key}
      value={itemValue}
      onSelect={onSelect}
      className="items-center gap-2 px-3 py-1.5"
    >
      <Check className={cn('size-4 text-foreground', isChecked ? 'opacity-100' : 'opacity-0')} />
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
        {icon}
        <span className="truncate">{label}</span>
      </span>
    </CommandItem>
  )
  if (!onSetDefault) {
    return row
  }
  return (
    // Why: z-[70] sits above PopoverContent's z-[60] so the right-click menu
    // renders in front of the still-open combobox popover instead of behind it.
    <ContextMenu key={key}>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="z-[70]">
        <ContextMenuItem onSelect={onSetDefault} disabled={isDefault}>
          <Star className="size-3.5" />
          {isDefault ? 'Current default' : 'Set as default'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function searchAgents(agents: AgentCatalogEntry[], rawQuery: string): AgentCatalogEntry[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return agents
  }
  // Why: cheap prefix-favored sort — label matches starting earlier in the
  // string outrank later matches, mirroring repo-search semantics so the
  // two comboboxes feel consistent.
  const matches: { agent: AgentCatalogEntry; score: number; index: number }[] = []
  agents.forEach((agent, index) => {
    const labelIdx = agent.label.toLowerCase().indexOf(query)
    const idIdx = agent.id.toLowerCase().indexOf(query)
    const score = labelIdx !== -1 ? labelIdx : idIdx !== -1 ? 1000 + idIdx : -1
    if (score !== -1) {
      matches.push({ agent, score, index })
    }
  })
  matches.sort((a, b) => a.score - b.score || a.index - b.index)
  return matches.map((m) => m.agent)
}

function searchCustomAgents(
  customAgents: CustomAgentProfile[],
  rawQuery: string
): CustomAgentProfile[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) {
    return customAgents
  }
  const matches: { profile: CustomAgentProfile; score: number; index: number }[] = []
  customAgents.forEach((profile, index) => {
    const labelIdx = profile.label.toLowerCase().indexOf(query)
    const baseIdx = profile.baseAgent.toLowerCase().indexOf(query)
    const score = labelIdx !== -1 ? labelIdx : baseIdx !== -1 ? 1000 + baseIdx : -1
    if (score !== -1) {
      matches.push({ profile, score, index })
    }
  })
  matches.sort((a, b) => a.score - b.score || a.index - b.index)
  return matches.map((m) => m.profile)
}

export default function AgentCombobox({
  agents,
  customAgents = [],
  value,
  onValueChange,
  onValueSelected,
  onOpenManageAgents,
  defaultAgent,
  onSetDefault,
  triggerClassName,
  onTriggerEnter
}: AgentComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Why: controlled cmdk selection so hovering the footer (which lives outside
  // the cmdk tree) can clear the list's highlighted item — otherwise cmdk keeps
  // the last-hovered agent visually selected while the mouse is on the footer.
  const [commandValue, setCommandValue] = useState('')
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  const selectedBuiltin = useMemo<AgentCatalogEntry | null>(
    () =>
      value.kind === 'builtin' ? (agents.find((agent) => agent.id === value.agent) ?? null) : null,
    [agents, value]
  )
  const selectedCustom = useMemo<CustomAgentProfile | null>(
    () => (value.kind === 'custom' ? value.profile : null),
    [value]
  )
  const filteredAgents = useMemo(() => searchAgents(agents, query), [agents, query])
  const filteredCustomAgents = useMemo(
    () => searchCustomAgents(customAgents, query),
    [customAgents, query]
  )
  const blankMatchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return true
    }
    return 'blank terminal'.includes(q) || 'terminal'.startsWith(q)
  }, [query])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const seedKey =
      value.kind === 'builtin'
        ? value.agent
        : value.kind === 'custom'
          ? `custom:${value.profile.id}`
          : BLANK_VALUE
    setCommandValue(seedKey)
    const frame = requestAnimationFrame(() => {
      const searchInput = document.querySelector<HTMLInputElement>(
        '[data-agent-combobox-root="true"] [data-slot="command-input"]'
      )
      if (!searchInput) {
        return
      }
      searchInput.focus()
      // Why: when a printable keydown on the trigger seeded the query, the user
      // expects the next keystroke to append to what they typed — not replace
      // it — so drop the caret at the end instead of selecting all.
      const end = searchInput.value.length
      searchInput.setSelectionRange(end, end)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, value])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }, [])

  const handleSelect = useCallback(
    (next: AgentSelection) => {
      onValueChange(next)
      setOpen(false)
      setQuery('')
      onValueSelected?.(next)
    },
    [onValueChange, onValueSelected]
  )

  // Why: mirror RepoCombobox's trigger-keydown handling — the button-style
  // trigger treats the current value as a confirmed selection. Plain focus does
  // not open the dropdown. Only explicit intent opens: Arrow keys open without
  // filtering; a printable non-whitespace char opens AND seeds the search
  // query (treating the keystroke as the start of a new search).
  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (open) {
        return
      }
      if (
        event.key === 'Enter' &&
        onTriggerEnter &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        onTriggerEnter()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault()
        setQuery(event.key)
        setOpen(true)
      }
    },
    [open, onTriggerEnter]
  )

  return (
    <div className="flex w-full items-center">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            onKeyDown={handleTriggerKeyDown}
            className={cn(
              'h-8 min-w-[184px] justify-between px-3 text-xs font-normal',
              triggerClassName
            )}
            data-agent-combobox-root="true"
          >
            {selectedBuiltin ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <AgentIcon agent={selectedBuiltin.id} />
                <span className="truncate">{selectedBuiltin.label}</span>
              </span>
            ) : selectedCustom ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <AgentIcon agent={selectedCustom.baseAgent} />
                <span className="truncate">{selectedCustom.label}</span>
              </span>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Terminal className="size-3.5" />
                <span className="truncate">Blank Terminal</span>
              </span>
            )}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0"
          data-agent-combobox-root="true"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command shouldFilter={false} value={commandValue} onValueChange={setCommandValue}>
            <CommandInput placeholder="Search agents..." value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No agents match your search.</CommandEmpty>
              {blankMatchesQuery
                ? renderItem({
                    key: BLANK_VALUE,
                    itemValue: BLANK_VALUE,
                    isChecked: value.kind === 'blank',
                    isDefault: defaultAgent === 'blank',
                    onSelect: () => handleSelect({ kind: 'blank' }),
                    onSetDefault: onSetDefault ? () => onSetDefault('blank') : undefined,
                    icon: <Terminal className="size-3.5" />,
                    label: 'Blank Terminal'
                  })
                : null}
              {filteredAgents.map((agent) =>
                renderItem({
                  key: agent.id,
                  itemValue: agent.id,
                  isChecked: value.kind === 'builtin' && value.agent === agent.id,
                  isDefault: defaultAgent === agent.id,
                  onSelect: () => handleSelect({ kind: 'builtin', agent: agent.id }),
                  onSetDefault: onSetDefault ? () => onSetDefault(agent.id) : undefined,
                  icon: <AgentIcon agent={agent.id} />,
                  label: agent.label
                })
              )}
              {filteredCustomAgents.map((profile) => {
                const key = `custom:${profile.id}`
                const isCustomDefault =
                  typeof defaultAgent === 'object' &&
                  defaultAgent !== null &&
                  defaultAgent.kind === 'custom' &&
                  defaultAgent.id === profile.id
                return renderItem({
                  key,
                  itemValue: key,
                  isChecked: value.kind === 'custom' && value.profile.id === profile.id,
                  isDefault: isCustomDefault,
                  onSelect: () => handleSelect({ kind: 'custom', profile }),
                  onSetDefault: onSetDefault
                    ? () => onSetDefault({ kind: 'custom', id: profile.id })
                    : undefined,
                  // Why: custom profiles inherit the base agent's icon so the
                  // picker visually groups variants of the same CLI together.
                  // The Wrench overlay disambiguates that this is a user-
                  // configured variant rather than a stock entry.
                  icon: (
                    <span className="relative inline-flex">
                      <AgentIcon agent={profile.baseAgent} />
                      <Wrench
                        className="absolute -right-1 -bottom-1 size-2 rounded-sm bg-background p-[1px] text-muted-foreground"
                        aria-hidden
                      />
                    </span>
                  ),
                  label: profile.label
                })
              })}
            </CommandList>
            {onOpenManageAgents ? (
              <div className="border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onOpenManageAgents}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCommandValue('')}
                  className="h-9 w-full justify-start rounded-none px-3 text-xs font-normal text-muted-foreground"
                >
                  Manage agents
                  <svg
                    className="ml-auto size-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
