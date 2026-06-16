import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runGitWorktreeRefreshBenchmark } from './git-worktree-refresh-benchmark'
import { renderReport } from './non-terminal-performance-report'
import { runSidebarRowProjectionBenchmark } from './sidebar-row-projection-benchmark'

const REPORT_PATH = 'NON_TERMINAL_PERFORMANCE_INVESTIGATION.md'

describe('non-terminal performance benchmarks', () => {
  it('measures sidebar rows and git worktree refresh fanout', async () => {
    const sidebarResults = runSidebarRowProjectionBenchmark()
    const gitResults = await runGitWorktreeRefreshBenchmark()

    await writeFile(REPORT_PATH, renderReport(sidebarResults, gitResults))
    console.info(`Wrote ${REPORT_PATH}`)
    expect(sidebarResults.length).toBeGreaterThan(0)
    expect(gitResults.length).toBeGreaterThan(0)
  }, 180_000)
})
