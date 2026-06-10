// Why: the parsing core moved to shared so main's terminal side-effect
// tracker can emit pr-link facts (terminal-side-effect-authority.md, slice 3).
// Re-exported here so renderer consumers keep their '@/lib' import path.
export * from '../../../shared/github-links'
