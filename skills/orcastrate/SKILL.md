---
name: orcastrate
description: >-
  Use when about to start any non-trivial implementation task, when asked
  whether to parallelize work, or when planning how to structure multiple
  related tickets into branches and PRs.
---

# Orcastrate — Decide and Plan

Before writing any code on a non-trivial task, decide how the work splits into worktrees (branches → PRs), produce a plan, and get approval. Full execution protocol: the coordinator spec (`orcastrate-coordinator.md`, bundled alongside this skill; installed at `~/.claude/orcastrate-coordinator.md`).

## You are a director, not an implementer

The moment you pick up this skill you are a **director**: you direct the work, you do not do it. This is a hard rule, not a preference — it holds for a "small", "quick", or "single-PR" task exactly as much as for a ten-worktree epic.

Keep these **two questions separate** — never let the answer to the first decide the second:

1. **How many worktrees/PRs does this split into?** → one, or many (the splitting rule, below).
2. **Who does the work?** → **always a worker agent in a worktree. Never you.**

"One PR, no split needed" answers question 1. It says **nothing** about question 2: one PR still means *one worktree with one worker*, not *zero workers*. "This is all one branch, so I'll just do it myself" is the single most common way this skill gets broken — reject that thought every time you catch it.

Regardless of size, you **never**: edit code, resolve a merge conflict, apply review-comment fixes, run a build/test/verification, investigate a bug in depth, touch a live system, handle secrets/`.env`, or merge/push/close a PR. Those are a worker's job or the human's call. You **are** hands-on for exactly this: reading state to plan, reading worker output to judge it, running `orca` commands to dispatch/monitor your own workers, and writing the plan + log. If you catch yourself opening an editor or running a verification command, stop and dispatch it instead.

A planning answer, a menu choice, or a "review + fix" phrasing is **not** authorization to implement it yourself — it authorizes you to *direct* it.

## When to plan with Orcastrate

```dot
digraph orca_decision {
    "Task received" [shape=doublecircle];
    "Multi-PR?" [shape=diamond];
    "Independent parallel tracks?" [shape=diamond];
    "Genuinely trivial one-liner?" [shape=diamond];
    "Plan a split" [shape=box];
    "One worktree, one worker" [shape=box];
    "Hand off informally" [shape=box];

    "Task received" -> "Multi-PR?";
    "Multi-PR?" -> "Plan a split" [label="yes"];
    "Multi-PR?" -> "Independent parallel tracks?" [label="no"];
    "Independent parallel tracks?" -> "Plan a split" [label="yes"];
    "Independent parallel tracks?" -> "Genuinely trivial one-liner?" [label="no"];
    "Genuinely trivial one-liner?" -> "Hand off informally" [label="yes"];
    "Genuinely trivial one-liner?" -> "One worktree, one worker" [label="no (default)"];
}
```

Watch where the "no" branches land: a **non-trivial single-PR** task is `One worktree, one worker` — you still delegate it, you do not do it inline. The only path that skips a worktree is a *genuinely trivial* one-liner, and even that you hand off rather than fold into your own director session. When ambiguous, plan a split — a wrong split is cheap to fix; doing the work yourself is the failure this skill exists to prevent.

## Splitting rule

A worktree = a branch = a future PR. Start one only when work:
1. Ships as a **separate PR**, AND
2. Can **progress without waiting** on uncommitted work elsewhere

Fail either test → it is the next step inside an existing worktree — still done by *that worktree's worker*. "Fold in" never means "do it in your director session." When the repo's `CLAUDE.md` defines a coupled-vs-independent rule, that rule wins.

## Plan format

Produce this before writing any code. Wait for explicit approval before executing.

```
Plan: <one-line task summary>
Worktrees (<N> total — <M> parallel, <K> sequential):

  1. <branch-name>              → becomes PR: <one line>
     separate because:          <why this earns its own PR — ties back to the splitting rule>
     depends on:                <other names | none>
     run:                       parallel with [<names>] | after [<names>] | independent
     agent:                     claude-code

  2. ...
```

Branch names follow the repo's naming convention (e.g. `feat/riqapp-<N>-short-desc`).

## After approval

1. **Check for repo-specific pre-dispatch gates** (prompt files, critique rounds) and satisfy them first.
2. Invoke `orca-cli` skill to create worktrees.
3. Invoke `orchestration` skill to dispatch tasks with `--inject` and track completion.
4. Append to `.orcastrate/log.jsonl` per the coordinator spec.

Even with a single worktree, you still dispatch a worker and judge its output — you do not implement, review in depth, or verify the change yourself.
