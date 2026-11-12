import { expect, test } from 'claude-code/testing'

import { buildTree, parseFiles, parseStatus } from '../hooks/git'

const STATUS = [
  '# branch.oid 0123456789abcdef',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaa bbb apps/api/src/app.ts',
  '1 .M N... 100644 100644 100644 aaa bbb docs/my notes.md',
  '1 MM N... 100644 100644 100644 aaa bbb README.md',
  '2 R. N... 100644 100644 100644 aaa bbb R100 apps/web/new.ts',
  'apps/web/old.ts',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc GLOSSARY.md',
  '? .specify/memory.md',
  '',
].join('\0')

test('parseStatus reads branch, ahead/behind and both groups', () => {
  const status = parseStatus(STATUS)

  expect(status.branch).toBe('main')
  expect(status.hasUpstream).toBe(true)
  expect(status.ahead).toBe(2)
  expect(status.behind).toBe(1)
  expect(status.staged).toEqual([
    { path: 'apps/api/src/app.ts', code: 'M' },
    { path: 'README.md', code: 'M' },
    { path: 'apps/web/new.ts', code: 'R' },
  ])
  expect(status.changes).toEqual([
    { path: 'docs/my notes.md', code: 'M' },
    { path: 'README.md', code: 'M' },
    { path: 'GLOSSARY.md', code: '!' },
    { path: '.specify/memory.md', code: 'U' },
  ])
})

test('parseStatus names a detached head by its short oid', () => {
  const status = parseStatus('# branch.oid 0123456789abcdef\0# branch.head (detached)\0')

  expect(status.branch).toBe('detached @ 0123456')
  expect(status.hasUpstream).toBe(false)
})

test('buildTree puts folders first and counts changes upwards', () => {
  const files = parseFiles('b.ts\0apps/web/x.ts\0apps/api/y.ts\0a.ts\0')
  const tree = buildTree(files, new Set(['apps/api/y.ts']))

  expect(tree.dirs.map(dir => dir.name)).toEqual(['apps'])
  expect(tree.files).toEqual(['a.ts', 'b.ts'])
  const apps = tree.dirs[0]
  expect(apps?.changed).toBe(1)
  expect(apps?.dirs.map(dir => [dir.name, dir.changed])).toEqual([
    ['api', 1],
    ['web', 0],
  ])
})

test('the pane says it is reading before the first git read', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'explorer',
      surface,
      component: 'Pane',
      requestId: 'explorer',
      props: {
        title: 'Explorer',
        isFocused: false,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })

    expect((await ui.find({ type: 'Text', text: /Reading git/ }))?.text).toBe('Reading git…')
    await ui.unmount()
  }
})
