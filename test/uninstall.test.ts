import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readUninstallReport } from 'kehikot-module-protocol'

const ROOT = join(import.meta.dirname, '..')

describe('Uninstall takes away what this module wrote outside its folder', () => {
  test('uninstall.ts, run as Kehikot runs it: its temporary folders go, and the report says so', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-uninstall-')))
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(base, 'home'), TMPDIR: join(base, 'tmp'), KEHIKOT_MODULES_DIR: join(base, 'modules') }
    for (const dir of [env.HOME!, env.TMPDIR!, env.KEHIKOT_MODULES_DIR!]) mkdirSync(dir, { recursive: true })
    const sessions = join(env.TMPDIR!, `kehikot-opencode-${process.getuid?.() ?? 'user'}`)
    const told = join(env.TMPDIR!, 'kehikot-opencode-told')
    const other = join(env.TMPDIR!, 'somebody-else')
    for (const dir of [sessions, told, other]) mkdirSync(join(dir, 'kehikot'), { recursive: true })
    writeFileSync(join(sessions, 'kehikot', 'pid'), '1')
    const run = () => readUninstallReport(execFileSync(process.execPath, ['uninstall.ts'], { cwd: ROOT, env, encoding: 'utf8' }))
    expect(run()).toEqual({
      removed: [
        { what: 'Its session folders in the temporary directory', path: sessions },
        { what: 'What its sessions were told, in the temporary directory', path: told },
      ],
      left: [],
    })
    expect(existsSync(sessions) || existsSync(told)).toBe(false)
    expect(existsSync(other)).toBe(true)
    expect(run()).toEqual({ removed: [], left: [] })
  })
})
