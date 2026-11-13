import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileChange, Snapshot } from '../types'
import { buildTree, parseFiles, parseStatus } from './git'
import type { TreeNode } from './git'

const PANE = 'explorer'
const POLL_MS = 10_000
const DEBOUNCE_MS = 300
const GROUP_CAP = 50

const snapshot = atom({ plugin: 'explorer', key: 'snapshot' } as const, { kind: 'loading' } as Snapshot, {
  shape: 'snapshot-1',
})
const overrides = atom({ plugin: 'explorer', key: 'overrides' } as const, {} as Record<string, boolean>, {
  shape: 'overrides-1',
})
const dismissed = atom({ plugin: 'explorer', key: 'dismissed' } as const, false, { shape: 'dismissed-1' })

// Module variables start over on a reload; the snapshot in $.state does not.
let isRunning = false
let isPending = false
let lastJson = ''
let hasTriedAutoOpen = false
let debounce: { cancel: () => void } | undefined

const run = ($: EngineInterface, argv: string[], cwd: string) =>
  // --no-optional-locks: the pane only reads, it never refreshes the index.
  $.process.run(['git', '--no-optional-locks', ...argv], { cwd, timeoutMs: 15_000 })

const collect = async ($: EngineInterface): Promise<Snapshot> => {
  const cwd = await $.session.cwd()
  const top = await run($, ['rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode !== 0) return { kind: 'no-repo', cwd }
  const root = top.stdout.trim()
  const [status, files] = await Promise.all([
    run($, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root),
    run($, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root),
  ])
  if (status.exitCode !== 0) return { kind: 'error', message: status.stderr.trim() }

  return { kind: 'repo', root, ...parseStatus(status.stdout), files: parseFiles(files.stdout) }
}

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

const paneTitle = (snap: Snapshot) => (snap.kind === 'repo' ? `Explorer · ${baseName(snap.root)}` : 'Explorer')

/**
 * The git summary now lives in ~/.claude/statusline.mjs, on the same row as
 * the model and tokens; this clears any entry an earlier version pinned.
 */
const syncStatus = async ($: EngineInterface, _snap: Snapshot) => {
  $.ui.status(undefined)
}

const refresh = async ($: EngineInterface) => {
  if (isRunning) {
    isPending = true
    return
  }
  isRunning = true
  try {
    do {
      isPending = false
      let snap: Snapshot
      try {
        snap = await collect($)
      } catch (error) {
        snap = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
      }
      const json = JSON.stringify(snap)
      if (json !== lastJson) {
        const hadRoot = lastJson === '' ? undefined : (JSON.parse(lastJson) as Snapshot)
        lastJson = json
        await update($, snapshot, () => snap)
        // Retitle an open pane when the worktree (or repo) changes.
        const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
        if (isOpen && (hadRoot === undefined || paneTitle(hadRoot) !== paneTitle(snap))) {
          await $.ui.open({ id: PANE, title: paneTitle(snap) })
        }
      }
      await syncStatus($, snap)
    } while (isPending)
  } finally {
    isRunning = false
  }
}

/** Coalesces bursts of tool calls into one git read. */
const refreshSoon = ($: EngineInterface) => {
  debounce?.cancel()
  debounce = $.clock.after(DEBOUNCE_MS, () => void refresh($))
}

const CODE_COLOR: Record<string, string> = {
  M: 'warning',
  A: 'success',
  U: 'success',
  D: 'error',
  R: 'suggestion',
  C: 'suggestion',
  '!': 'error',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'explorer',
      description: 'Show or hide the explorer pane (git status and file tree)',
    })
    $.clock.every(POLL_MS, () => void refresh($))
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'explorer' }, async $ => {
    const panes = await $.ui.panes()
    const pane = panes.find(one => one.id === PANE)
    if (pane?.isShown && pane.isPlaced) {
      await $.ui.close({ id: PANE })
      await syncStatus($, await read($, snapshot))
      return { text: 'Explorer pane closed.' }
    }
    await update($, dismissed, () => false)
    const snap = await read($, snapshot)
    await $.ui.open({ id: PANE, title: paneTitle(snap) })
    await refresh($)
    await syncStatus($, snap)

    return { text: 'Explorer pane opened.' }
  })

  // The person closing the pane means: do not open it again by itself.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') {
      await update($, dismissed, () => true)
      await syncStatus($, await read($, snapshot))
    }

    return closed
  })

  // Every tool call may have touched files or git: read again shortly after.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    refreshSoon($)

    return ran
  })

  // Opens the pane unasked only where it would be a sidebar (fullscreen
  // terminal) and only in a repo; the 144-column floor is the engine's.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!hasTriedAutoOpen && e.surface === 'terminal' && e.viewport?.isFullscreen === true) {
      const snap = await read($, snapshot)
      if (snap.kind !== 'loading') {
        hasTriedAutoOpen = true
        const isDismissed = await read($, dismissed)
        const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
        if (snap.kind === 'repo' && !isDismissed && !isOpen) {
          void $.ui.open({ id: PANE, title: paneTitle(snap) }).then(() => syncStatus($, snap))
        }
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)

    if (snap.kind === 'loading') return <Text dimColor>Reading git…</Text>
    if (snap.kind === 'no-repo') {
      return (
        <Box flexDirection="column">
          <Text>Not a git repository.</Text>
          <Text dimColor wrap="truncate-start">
            {snap.cwd}
          </Text>
        </Box>
      )
    }
    if (snap.kind === 'error') {
      return (
        <Box flexDirection="column">
          <Text color="error">git failed</Text>
          <Text dimColor>{snap.message}</Text>
        </Box>
      )
    }

    const opened = await read($, overrides)
    const marks = new Map<string, string>()
    for (const change of snap.staged) marks.set(change.path, change.code)
    // The working-tree side wins in the tree: it is what is on disk now.
    for (const change of snap.changes) marks.set(change.path, change.code)
    const tree = buildTree([...snap.files, ...marks.keys()], new Set(marks.keys()))
    const isOpen = (node: TreeNode) => opened[node.path] ?? node.changed > 0

    const code = (value: string) => (
      <Text color={CODE_COLOR[value] ?? 'text'} weight="bold">
        {value}
      </Text>
    )

    const group = (label: string, list: FileChange[]) => (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor weight="bold">
          {label} · {list.length}
        </Text>
        {list.slice(0, GROUP_CAP).map(change => (
          <Text wrap="truncate-start">
            {code(change.code)} {change.path}
          </Text>
        ))}
        {list.length > GROUP_CAP && <Text dimColor>+{list.length - GROUP_CAP} more</Text>}
      </Box>
    )

    const rows: JSX.Element[] = []
    const walk = (node: TreeNode, depth: number) => {
      const indent = '  '.repeat(depth)
      for (const dir of node.dirs) {
        const open = isOpen(dir)
        const fallback = dir.changed > 0
        rows.push(
          <Button
            key={`d:${dir.path}`}
            plain
            onPress={() =>
              update($, overrides, all => ({ ...all, [dir.path]: !(all[dir.path] ?? fallback) }))
            }
          >
            {indent}
            {open ? '▾ ' : '▸ '}
            {dir.name}/{dir.changed > 0 && <Text color="warning"> ●{dir.changed}</Text>}
          </Button>,
        )
        if (open) walk(dir, depth + 1)
      }
      for (const file of node.files) {
        const mark = marks.get(file)
        rows.push(
          <Text wrap="truncate-end">
            {indent}
            {mark === undefined ? ' ' : code(mark)} {file.slice(file.lastIndexOf('/') + 1)}
          </Text>,
        )
      }
    }
    walk(tree, 0)

    const isClean = snap.staged.length === 0 && snap.changes.length === 0

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="claude" weight="bold">
            ⎇ {snap.branch}
          </Text>
          {snap.hasUpstream ? (
            <Text>
              {'  '}↑{snap.ahead} ↓{snap.behind}
            </Text>
          ) : (
            <Text dimColor> no upstream</Text>
          )}
        </Text>
        <Box marginBottom={1}>
          <Text dimColor wrap="truncate-start">
            {snap.root}
          </Text>
        </Box>
        {isClean && (
          <Box marginBottom={1}>
            <Text color="success">✓ Working tree clean</Text>
          </Box>
        )}
        {snap.staged.length > 0 && group('STAGED', snap.staged)}
        {snap.changes.length > 0 && group('CHANGES', snap.changes)}
        <Text dimColor weight="bold">
          FILES · {snap.files.length}
        </Text>
        {rows}
      </Box>
    )
  })
}
