import { describe, expect, it } from 'vitest'
import { hasOnlyDisposableWorktreeMetadata } from './disposable-worktree-metadata'

describe('hasOnlyDisposableWorktreeMetadata', () => {
  it('matches root and nested disposable metadata status lines', () => {
    expect(
      hasOnlyDisposableWorktreeMetadata(
        '?? .DS_Store\n?? nested/.DS_Store\n?? Thumbs.db\n?? nested/Desktop.ini\n'
      )
    ).toBe(true)
  })

  it('matches git-quoted disposable metadata paths', () => {
    expect(hasOnlyDisposableWorktreeMetadata('?? ".DS_Store"\n?? "nested/Thumbs.db"\n')).toBe(true)
    expect(hasOnlyDisposableWorktreeMetadata('?? "nested dir/.DS_Store"\n')).toBe(true)
  })

  it('does not treat filenames ending in disposable metadata names as disposable', () => {
    expect(hasOnlyDisposableWorktreeMetadata('?? "old .DS_Store"\n')).toBe(false)
    expect(hasOnlyDisposableWorktreeMetadata('?? backup Thumbs.db\n')).toBe(false)
  })

  it('does not match paths the cleanup pathspecs do not target', () => {
    expect(hasOnlyDisposableWorktreeMetadata('?? "foo\\".DS_Store"\n')).toBe(false)
    expect(hasOnlyDisposableWorktreeMetadata('?? "foo\\\\.DS_Store"\n')).toBe(false)
    expect(hasOnlyDisposableWorktreeMetadata('?? .ds_store\n')).toBe(false)
    expect(hasOnlyDisposableWorktreeMetadata('?? thumbs.db\n')).toBe(false)
  })

  it('rejects mixed disposable metadata and real untracked files', () => {
    expect(hasOnlyDisposableWorktreeMetadata('?? .DS_Store\n?? scratch.txt\n')).toBe(false)
  })
})
