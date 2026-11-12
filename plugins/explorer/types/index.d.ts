/** One changed file and its one-letter status code (M, A, D, R, C, U, !). */
export type FileChange = { path: string; code: string }

/** What the last git read found in the session's current directory. */
export type Snapshot =
  | { kind: 'loading' }
  | { kind: 'no-repo'; cwd: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'repo'
      root: string
      branch: string
      hasUpstream: boolean
      ahead: number
      behind: number
      staged: FileChange[]
      changes: FileChange[]
      /** Tracked files plus untracked ones git does not ignore, repo-relative. */
      files: string[]
    }

declare module 'claude-code' {
  interface PluginState {
    explorer: {
      snapshot: Shaped<Snapshot>
      /** Folders the person opened or folded, by repo-relative path. */
      overrides: Shaped<Record<string, boolean>>
      /** The person closed the pane: it is not opened again unasked. */
      dismissed: Shaped<boolean>
    }
  }
}
