import { describe, expect, test } from 'bun:test'
import { placedGuardsSchema } from 'kehikot-module-protocol'

import { GUARDED_TOOLS, guardAnswer, postedCall, type EditFiles } from '../context.ts'

/**
 * Edit guards through the protocol's one check (`checkToolCall`, protocol 2.80.0): OpenCode's file tools
 * (`edit`, `write`, `multiedit`, the file in `filePath` or `path`; `patch`, every file its `patchText`
 * touches), posted by the plugin, are refused in a main checkout or under paths a module names.
 */

const guards = placedGuardsSchema.parse([
  {
    module: 'kehikot.worktrees',
    name: 'Worktrees',
    guard: { id: 'main-checkout', tool: 'edit', match: { checkouts: ['main'], paths: ['~/Library/Application Support/Kehikot/installed/**'] }, action: 'deny', why: 'Work in a worktree: git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main' },
  },
])

const files: EditFiles = { home: '/Users/p', checkoutOf: (path) => (path.startsWith('/Users/p/Projects/app/') ? 'main' : path.startsWith('/Users/p/Projects/app-worktrees/') ? 'linked' : null) }
const posts = (file: string) => [
  { tool: 'edit', args: { filePath: file } },
  { tool: 'write', args: { path: file } },
  { tool: 'multiedit', args: { filePath: file } },
  { tool: 'patch', args: { patchText: `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch` } },
]

describe('edit guards', () => {
  test('the plugin is told the protocol’s tools and only the args the guards read', () => {
    expect(GUARDED_TOOLS).toEqual({ bash: ['command'], edit: ['filePath', 'path'], write: ['filePath', 'path'], multiedit: ['filePath', 'path'], patch: ['patchText'], apply_patch: ['patchText'] })
  })

  test('an edit in a main checkout is refused with the module’s words', () => {
    for (const post of posts('/Users/p/Projects/app/src/a.ts')) {
      const answer = guardAnswer(post, guards, false, null, files)
      expect(answer).toMatchObject({ action: 'deny' })
      expect(answer?.says).toContain('git worktree add')
    }
  })

  test('a relative path is read against the session’s folder', () => {
    expect(guardAnswer({ tool: 'edit', args: { filePath: 'src/a.ts' }, cwd: '/Users/p/Projects/app' }, guards, false, null, files)).toMatchObject({ action: 'deny' })
    expect(guardAnswer({ tool: 'edit', args: { filePath: 'src/a.ts' }, cwd: '/Users/p/Projects/app-worktrees/x' }, guards, false, null, files)).toBeNull()
  })

  test('an installed module’s folder is refused, a worktree and elsewhere pass', () => {
    for (const post of posts('/Users/p/Library/Application Support/Kehikot/installed/kehikot.queue/x.ts')) expect(guardAnswer(post, guards, false, null, files)).toMatchObject({ action: 'deny' })
    for (const post of [...posts('/Users/p/Projects/app-worktrees/x/a.ts'), ...posts('/tmp/note.md')]) expect(guardAnswer(post, guards, false, null, files)).toBeNull()
  })

  test('KEHIKOT_DIRECT in the session passes, and no edit guard means nothing is asked', () => {
    expect(guardAnswer({ tool: 'edit', args: { filePath: '/Users/p/Projects/app/a.ts' } }, guards, true, null, files)).toBeNull()
    expect(guardAnswer({ tool: 'edit', args: { filePath: '/Users/p/Projects/app/a.ts' } }, [], false, null, { home: null, checkoutOf: () => { throw new Error('not asked') } })).toBeNull()
  })

  test('an older plugin’s { command } is a shell command; anything else is nothing', () => {
    expect(postedCall({ command: 'ls' })).toEqual({ tool: 'bash', args: { command: 'ls' }, cwd: null })
    expect(postedCall({ tool: 'edit', args: null })).toBeNull()
    expect(postedCall(null)).toBeNull()
    expect(guardAnswer({ tool: 'read', args: { filePath: '/Users/p/Projects/app/a.ts' } }, guards, false, null, files)).toBeNull()
    expect(guardAnswer({ tool: 'bash', args: { command: 'echo x > /Users/p/Projects/app/a.ts' } }, guards, false, null, files)).toBeNull()
  })
})
