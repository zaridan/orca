const disposableWorktreeMetadataFilenames = ['.DS_Store', 'Thumbs.db', 'Desktop.ini']

export const disposableWorktreeMetadataPathspecs = disposableWorktreeMetadataFilenames.flatMap(
  (filename) => [filename, `:(glob)**/${filename}`]
)

export function hasOnlyDisposableWorktreeMetadata(statusOutput: string): boolean {
  const statusLines = statusOutput.split(/\r?\n/).filter((line) => line.trim())
  return (
    statusLines.length > 0 &&
    statusLines.every((line) => {
      if (!line.startsWith('?? ')) {
        return false
      }
      return isDisposableWorktreeMetadataPath(line.slice(3).trim())
    })
  )
}

function isDisposableWorktreeMetadataPath(statusPath: string): boolean {
  const path = stripSurroundingGitStatusQuotes(statusPath)
  const slashIndex = path.lastIndexOf('/')
  const basename = slashIndex === -1 ? path : path.slice(slashIndex + 1)
  return disposableWorktreeMetadataFilenames.includes(basename)
}

function stripSurroundingGitStatusQuotes(statusPath: string): string {
  if (statusPath.startsWith('"') && statusPath.endsWith('"')) {
    // Why: Git quotes the full path; escaped quotes inside are filename
    // content, not basename boundaries for the cleanup pathspecs.
    return statusPath.slice(1, -1)
  }
  return statusPath
}
