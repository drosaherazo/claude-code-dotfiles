import type { FileChange } from '../types'

export type Status = {
  branch: string
  hasUpstream: boolean
  ahead: number
  behind: number
  staged: FileChange[]
  changes: FileChange[]
}

/** The part of a record after its first `n` space-separated fields. */
const after = (record: string, n: number): string => {
  let at = 0
  for (let i = 0; i < n; i++) at = record.indexOf(' ', at) + 1
  return record.slice(at)
}

/**
 * Parses `git status --porcelain=v2 --branch -z --untracked-files=all`.
 * `.` in the XY pair means unchanged on that side; `?` untracked is shown as U.
 */
export const parseStatus = (out: string): Status => {
  const status: Status = {
    branch: '',
    hasUpstream: false,
    ahead: 0,
    behind: 0,
    staged: [],
    changes: [],
  }
  let oid = ''
  const records = out.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    if (record === '') continue
    if (record.startsWith('# branch.oid ')) oid = record.slice(13)
    else if (record.startsWith('# branch.head ')) status.branch = record.slice(14)
    else if (record.startsWith('# branch.upstream ')) status.hasUpstream = true
    else if (record.startsWith('# branch.ab ')) {
      const [a, b] = record.slice(12).split(' ')
      status.ahead = Math.abs(Number(a ?? 0)) || 0
      status.behind = Math.abs(Number(b ?? 0)) || 0
    } else if (record.startsWith('? ')) {
      status.changes.push({ path: record.slice(2), code: 'U' })
    } else if (record.startsWith('u ')) {
      status.changes.push({ path: after(record, 10), code: '!' })
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const isRename = record[0] === '2'
      const path = after(record, isRename ? 9 : 8)
      // -z puts a rename's original path in the next record.
      if (isRename) i++
      const [x, y] = [record[2] ?? '.', record[3] ?? '.']
      if (x !== '.') status.staged.push({ path, code: x })
      if (y !== '.') status.changes.push({ path, code: y })
    }
  }
  if (status.branch === '(detached)') {
    status.branch = oid ? `detached @ ${oid.slice(0, 7)}` : 'detached'
  }

  return status
}

/** Splits `git ls-files -z` output into paths. */
export const parseFiles = (out: string): string[] =>
  out.split('\0').filter(path => path !== '')

export type TreeNode = {
  name: string
  path: string
  dirs: TreeNode[]
  files: string[]
  /** Changed files at or below this folder. */
  changed: number
}

/** Builds the folder tree, folders first, each level sorted by name. */
export const buildTree = (
  files: readonly string[],
  changed: ReadonlySet<string>,
): TreeNode => {
  type Draft = { node: TreeNode; dirs: Map<string, Draft> }
  const draft = (name: string, path: string): Draft => ({
    node: { name, path, dirs: [], files: [], changed: 0 },
    dirs: new Map(),
  })
  const root = draft('', '')
  for (const file of new Set(files)) {
    const parts = file.split('/')
    const isChanged = changed.has(file)
    let at = root
    if (isChanged) at.node.changed++
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] ?? ''
      let next = at.dirs.get(part)
      if (next === undefined) {
        next = draft(part, parts.slice(0, i + 1).join('/'))
        at.dirs.set(part, next)
      }
      at = next
      if (isChanged) at.node.changed++
    }
    at.node.files.push(file)
  }
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  const finish = (d: Draft): TreeNode => ({
    ...d.node,
    dirs: [...d.dirs.values()]
      .map(finish)
      .sort((a, b) => byName(a.name, b.name)),
    files: d.node.files.sort(byName),
  })

  return finish(root)
}
