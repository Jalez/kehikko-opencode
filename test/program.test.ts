import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { BREW_LINE, CURL_LINE, PROGRAM, WORDS, databaseFile, dataDir, deniedWrite, folderOfRecord, hasBrew, headOf, home, installFor, isDefaultTitle, learnSession, nativeOf, npmPrefix, readPs, recordFile, sessionName, sessionsQuery, versionOf } from '../program.ts'
import { DATA, HOME } from './setup.ts'
import { T0, retitle, typed, writeRollout } from './transcripts.ts'

/**
 * The adapter, against a stand-in `opencode` and a scratch OpenCode database.
 *
 * Nothing here runs the real program or reads a real record: `test/setup.ts` has already pointed
 * the home folder, OpenCode's data folder and PATH at scratch.
 */

const STAND_IN = join(import.meta.dir, 'stand-in', 'opencode')
const made: string[] = []
const scratch = (name: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `kehikko-opencode-${name}-`)))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  rmSync(join(HOME, '.opencode'), { recursive: true, force: true })
})

const A = 'ses_01a175cc82f077b1a11b77a47b470116'
const B = 'ses_01a175cd511f7de0b01009ebe2616f33'

describe('where it keeps things', () => {
  test('its data folder follows XDG_DATA_HOME, else ~/.local/share; its database is opencode.db there unless OPENCODE_DB says', () => {
    expect(dataDir()).toBe(join(DATA, 'opencode'))
    expect(dataDir({ HOME: '/h' })).toBe('/h/.local/share/opencode')
    expect(databaseFile({ HOME: '/h' })).toBe('/h/.local/share/opencode/opencode.db')
    expect(databaseFile({ HOME: '/h', OPENCODE_DB: '/x/y.db' })).toBe('/x/y.db')
    expect(databaseFile({ HOME: '/h', OPENCODE_DB: 'other.db' })).toBe('/h/.local/share/opencode/other.db')
    expect(home({ HOME: '/h' })).toBe('/h')
  })
})

describe('finding the binary', () => {
  test('on PATH first, then the usual places a thin PATH leaves out, the installer’s own folder first', () => {
    const bin = scratch('bin')
    copyFileSync(STAND_IN, join(bin, 'opencode'))
    chmodSync(join(bin, 'opencode'), 0o755)
    const found = PROGRAM.find({ HOME, PATH: `${bin}:/usr/bin`, KEHIKOT_OPENCODE_TOOL_DIRS: '' })
    expect(found.file).toBe(join(bin, 'opencode'))
    const none = PROGRAM.find({ HOME, PATH: '/usr/bin', KEHIKOT_OPENCODE_TOOL_DIRS: '' })
    expect(none.file).toBeNull()
    expect(none.usual[0]).toBe(join(HOME, '.opencode', 'bin'))
    expect(none.usual).toContain('/opt/homebrew/bin')
  })

  test('an npm launcher is run as the native binary behind it, so no `node` has to be on PATH', () => {
    const root = scratch('npm')
    const pkg = join(root, 'lib', 'node_modules', 'opencode-ai')
    mkdirSync(join(pkg, 'bin'), { recursive: true })
    writeFileSync(join(pkg, 'bin', 'opencode'), '#!/usr/bin/env node\n')
    chmodSync(join(pkg, 'bin', 'opencode'), 0o755)
    const native = join(root, 'lib', 'node_modules', `opencode-${process.platform}-${process.arch}`, 'bin', 'opencode')
    mkdirSync(join(native, '..'), { recursive: true })
    writeFileSync(native, 'binary')
    chmodSync(native, 0o755)
    mkdirSync(join(root, 'bin'))
    symlinkSync(join(pkg, 'bin', 'opencode'), join(root, 'bin', 'opencode'))
    expect(nativeOf(join(root, 'bin', 'opencode'))).toBe(native)
    /* The copy the launcher keeps beside itself is preferred. */
    writeFileSync(join(pkg, 'bin', '.opencode'), 'binary')
    chmodSync(join(pkg, 'bin', '.opencode'), 0o755)
    expect(nativeOf(join(root, 'bin', 'opencode'))).toBe(join(pkg, 'bin', '.opencode'))
    /* Anything else is run as it is. */
    expect(nativeOf(STAND_IN)).toBe(STAND_IN)
  })
})

describe('whether a copy can do what is asked of it', () => {
  const copy = (name: string) => {
    const bin = scratch(name)
    copyFileSync(STAND_IN, join(bin, 'opencode'))
    chmodSync(join(bin, 'opencode'), 0o755)
    copyFileSync(join(import.meta.dir, 'stand-in', 'opencode.ts'), join(bin, 'opencode.ts'))
    return join(bin, 'opencode')
  }

  test('a 1.x copy with `--session` can: it takes a configuration folder, a plugin, skills and, from 1.14.49, a plugin’s tool', async () => {
    const able = await PROGRAM.supports(copy('able'))
    expect(able).toMatchObject({ ok: true, missing: null, tells: true, lists: true, configures: true, plugins: true, tools: true, version: '1.19.5' })
  })

  test('one with no `--session` is too old, and says what it lacks', async () => {
    process.env.STANDIN_OLD = '1'
    try {
      expect(await PROGRAM.supports(copy('old'))).toMatchObject({ ok: false, missing: '--session' })
    } finally {
      delete process.env.STANDIN_OLD
    }
  })

  test('one before 1.0 is started as in a terminal: no folder, no state; before 1.14.49 no tool', async () => {
    process.env.STANDIN_VERSION = '0.15.2'
    try {
      expect(await PROGRAM.supports(copy('zero'))).toMatchObject({ ok: true, tells: false, configures: false, plugins: false, tools: false })
    } finally {
      delete process.env.STANDIN_VERSION
    }
    process.env.STANDIN_VERSION = '1.12.0'
    try {
      expect(await PROGRAM.supports(copy('twelve'))).toMatchObject({ ok: true, tells: true, configures: true, tools: false })
    } finally {
      delete process.env.STANDIN_VERSION
    }
  })

  test('one whose answers cannot be read at all is not called too old: nothing was learned, and nothing extra is passed', async () => {
    const bin = scratch('mute')
    writeFileSync(join(bin, 'opencode'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(bin, 'opencode'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'opencode'))).toMatchObject({ ok: true, tells: false, configures: false })
  })

  test('a version is read out of whatever line names it', () => {
    expect(versionOf('1.19.5')).toEqual([1, 19, 5])
    expect(versionOf('opencode 2.2.5\n')).toEqual([2, 2, 5])
    expect(versionOf('nothing')).toBeNull()
  })
})

describe('starting and resuming', () => {
  test('a new session has no arguments of its own — OpenCode chooses the id; a recorded one is `--session <id>`', () => {
    expect(PROGRAM.fresh(A)).toEqual([])
    expect(PROGRAM.resume(A)).toEqual(['--session', A])
    /* The sentence for a conversation a restart cut off is the plugin's to send, never an argument. */
    expect(PROGRAM.resume(A, undefined, 'Kehikot restarted…')).toEqual(['--session', A])
    expect(() => PROGRAM.resume('--dangerous')).toThrow()
  })

  test('an id it mints is one it accepts, spelled as OpenCode spells one, and what is not an id is refused', () => {
    const id = PROGRAM.newId()
    expect(PROGRAM.isId(id)).toBe(true)
    expect(id.startsWith('ses_kehikot')).toBe(true)
    expect(PROGRAM.isId(A)).toBe(true)
    for (const bad of ['', 'ses_', 'ses_a b', '11111111-1111-4111-8111-111111111111', '../ses_aaaaaaaaaaaa', `ses_${'a'.repeat(80)}`]) expect(PROGRAM.isId(bad)).toBe(false)
  })

  test('the session’s environment does not say it is inside another OpenCode, and keeps the person’s keys where they are', () => {
    const env = PROGRAM.environment({ PATH: '/bin', OPENCODE: '1', OPENCODE_CONFIG_DIR: '/other', OPENCODE_SERVER_PASSWORD: 'p', KEHIKOT_OPENCODE_SESSION: A, ANTHROPIC_API_KEY: 'k' })
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_API_KEY: 'k' })
  })

  test('a session runs the person’s bun and node, never the ones the host put first on this module’s PATH', () => {
    const dir = scratch('person-env')
    const hostShim = join(dir, 'kehikot-bun-1')
    const bunNode = join(dir, 'bun-node-502-x')
    for (const one of [hostShim, bunNode]) {
      mkdirSync(one)
      symlinkSync(process.execPath, join(one, 'bun'))
    }
    symlinkSync(process.execPath, join(bunNode, 'node'))
    const person = join(dir, 'person')
    mkdirSync(person)
    writeFileSync(join(person, 'bun'), '#!/bin/sh\necho person-bun\n')
    chmodSync(join(person, 'bun'), 0o755)
    const env = PROGRAM.environment({ PATH: [bunNode, hostShim, person, '/usr/bin', '/bin'].join(delimiter), KEHIKOT_HOST_PATH: hostShim, BUN_BE_BUN: '1' })
    expect(env.BUN_BE_BUN).toBeUndefined()
    expect(env.KEHIKOT_HOST_PATH).toBeUndefined()
    expect(env.PATH).toBe([person, '/usr/bin', '/bin'].join(delimiter))
    const ran = spawnSync('/bin/sh', ['-c', 'command -v bun; bun --version'], { env, encoding: 'utf8' })
    expect(ran.stdout).toBe(`${join(person, 'bun')}\nperson-bun\n`)
  })
})

describe('what the plugin says', () => {
  test('working, needs you, finished — and an interrupt is a turn that is over; the rest are no state', () => {
    expect(PROGRAM.signal('UserPromptSubmit')).toBe('working')
    expect(PROGRAM.signal('PostToolUse')).toBe('working')
    expect(PROGRAM.signal('PermissionRequest')).toBe('needs-you')
    expect(PROGRAM.signal('AskUser')).toBe('needs-you')
    expect(PROGRAM.signal('Stop')).toBe('finished')
    expect(PROGRAM.signal('Interrupt')).toBe('finished')
    for (const word of ['SessionStart', 'Compacted', 'SubagentStart', 'SubagentStop', 'Usage', 'toString', 'nonsense']) expect(PROGRAM.signal(word)).toBeNull()
  })

  test('every word the plugin posts is one this module knows', () => {
    const plugin = readFileSync(join(import.meta.dir, '..', 'plugin', 'opencode', 'kehikot.js'), 'utf8')
    const said = new Set([...plugin.matchAll(/(?:say\([^,()]+(?:\([^)]*\))?, |tell\()'([A-Za-z]+)'/g)].map((one) => one[1]!))
    expect([...said].sort()).toEqual([...WORDS].sort())
  })
})

describe('reading a project’s sessions', () => {
  test('a folder’s top-level sessions, most recently active first; the label is the title, or the first prompt while OpenCode’s default title stands', async () => {
    const project = scratch('project')
    const elsewhere = scratch('elsewhere')
    writeRollout(A, project, [typed(T0, 'fix the login\nmore lines'), typed(T0 + 5, 'and the tests')], T0 + 1000)
    writeRollout(B, project, [typed(T0, 'write docs')], T0 + 2000, { title: 'Docs for the parser', cost: 0.42 })
    writeRollout('ses_child0000000000aaaa', project, [typed(T0, 'a subagent')], T0 + 3000, { parent: A })
    writeRollout('ses_archived000000aaaa', project, [typed(T0, 'old')], T0 + 4000, { archived: true })
    writeRollout('ses_elsewhere00000aaaa', elsewhere, [typed(T0, 'other')], T0 + 5000)
    const found = await PROGRAM.sessions(project)
    expect(found.map((one) => one.id)).toEqual([B, A])
    expect(found[1]).toMatchObject({ id: A, label: 'fix the login', firstPrompt: 'fix the login', lastPrompt: 'and the tests', lastActive: T0 + 1000, cost: 0 })
    expect(found[0]).toMatchObject({ id: B, label: 'Docs for the parser', firstPrompt: 'write docs', cost: 0.42 })
    /* One named is found wherever it ran. */
    expect((await PROGRAM.sessions(project, ['ses_elsewhere00000aaaa'])).map((one) => one.id)).toContain('ses_elsewhere00000aaaa')
    /* A title set later is read again: the database changed. */
    retitle(A, 'Login fixes')
    expect((await PROGRAM.sessions(project)).find((one) => one.id === A)?.label).toBe('Login fixes')
    expect(await folderOfRecord(A)).toBe(project)
  })

  test('the only words read are the person’s own: what Kehikot added to a prompt is never a label', async () => {
    const project = scratch('synthetic')
    writeRollout(A, project, [typed(T0, 'the real words')])
    const found = await PROGRAM.sessions(project)
    expect(found[0]!.firstPrompt).toBe('the real words')
    expect(JSON.stringify(found)).not.toContain('Kehikot: notes')
  })

  test('the query names folders and ids as literals, and an id that is not one is never in it', () => {
    const sql = sessionsQuery(["/tmp/it's here"], [A, "x' or 1=1 --"])
    expect(sql).toContain("'/tmp/it''s here'")
    expect(sql).toContain(`'${A}'`)
    expect(sql).not.toContain('or 1=1')
    expect(sessionsQuery([], [])).toBe('select 1 where 0')
  })

  test('OpenCode’s default titles are known as such', () => {
    expect(isDefaultTitle('New session - 2026-10-21T17:30:00.000Z')).toBe(true)
    expect(isDefaultTitle('Child session - 2026-10-21T17:30:00.000Z')).toBe(true)
    expect(isDefaultTitle('New session for the parser')).toBe(false)
  })

  test('no database, or no sqlite3, is no sessions — never a failure', async () => {
    expect(await PROGRAM.sessions('/nowhere')).toEqual([])
    const before = process.env.KEHIKOT_OPENCODE_SQLITE
    process.env.KEHIKOT_OPENCODE_SQLITE = ''
    try {
      expect(await PROGRAM.sessions(scratch('nosqlite'), ['ses_nosqlite00000aaaa'])).toEqual([])
    } finally {
      if (before === undefined) delete process.env.KEHIKOT_OPENCODE_SQLITE
      else process.env.KEHIKOT_OPENCODE_SQLITE = before
    }
  })

  test('a session exists once OpenCode has a record of it; a new one is named by its plugin', async () => {
    const project = scratch('settle')
    const opened = PROGRAM.newId()
    const real = 'ses_settled0000000aaaaa'
    expect(await PROGRAM.settled(project, opened, 0)).toBeNull()
    learnSession(opened, real)
    expect(await PROGRAM.settled(project, opened, 0)).toBeNull()
    writeRollout(real, project, [typed(T0)])
    expect(await PROGRAM.settled(project, opened, 0)).toBe(real)
    expect(await PROGRAM.settled(project, real, 0)).toBe(real)
  })

  test('there is no transcript file; a conversation is where it is', async () => {
    expect(await recordFile('/x', A)).toBeNull()
    expect(headOf(A)).toBe(A)
  })

  test('a place’s name is one line, never a flag', () => {
    expect(sessionName(['--epic', 'a\nb', null, ' parts '])).toBe('epic · a b · parts')
  })
})

describe('which process was started on which conversation', () => {
  test('ps lines of the program itself, with `--session`, `--session=` or `-s`, and nothing else', () => {
    const said = readPs([
      `  101 /Users/x/.opencode/bin/opencode --session ${A}`,
      `  102 /opt/homebrew/bin/opencode -s ${B} --model a/b`,
      `  103 /x/node_modules/opencode-ai/bin/.opencode --session=ses_third0000000000aaaa`,
      `  104 vim notes-about-opencode --session ses_vim000000000000aaaa`,
      `  105 /bin/zsh -c echo opencode`,
      `  106 /usr/local/bin/opencode`,
      '    1 /sbin/launchd',
    ].join('\n'))
    expect([...said]).toEqual([
      [A, 101],
      [B, 102],
      ['ses_third0000000000aaaa', 103],
    ])
  })

  test('a process seen on a conversation is said with the folder its record names', async () => {
    const project = scratch('active')
    writeRollout(A, project, [typed(T0)])
    const tools = scratch('ps')
    writeFileSync(join(tools, 'ps'), `#!/bin/sh\necho "  4242 /x/opencode --session ${A}"\n`)
    chmodSync(join(tools, 'ps'), 0o755)
    const running = await PROGRAM.active('/x/opencode', { ...process.env, KEHIKOT_OPENCODE_PS: join(tools, 'ps') })
    expect(running).toEqual({ known: true, active: [{ session: A, kind: 'interactive', called: 'an OpenCode process', handle: null, pid: 4242, cwd: project, startedAt: null, name: '', state: null, status: null }] })
    expect(await PROGRAM.active('/x/opencode', { ...process.env, KEHIKOT_OPENCODE_PS: '' })).toEqual({ known: false, why: 'failed' })
  })
})

const tool = (dir: string, name: string, body: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, name), 0o755)
}
const executable = (file: string) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
}

describe('finding it where an install lands', () => {
  test('in ~/.opencode/bin, where the installer puts it and a thin PATH leaves out', () => {
    const at = scratch('home')
    executable(join(at, '.opencode', 'bin', 'opencode'))
    expect(PROGRAM.find({ HOME: at, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: '' }).file).toBe(join(at, '.opencode', 'bin', 'opencode'))
  })

  test('in the bin folder of npm’s own global prefix, as `npm prefix -g` says it', () => {
    const root = scratch('prefix')
    const prefix = join(root, 'custom-prefix')
    tool(join(root, 'tools'), 'npm', `[ "$1 $2" = "prefix -g" ] && echo ${prefix}`)
    executable(join(prefix, 'bin', 'opencode'))
    const env = { HOME: root, PATH: join(root, 'tools'), KEHIKOT_OPENCODE_TOOL_DIRS: '' }
    expect(npmPrefix(env)).toBe(prefix)
    expect(PROGRAM.find(env).file).toBe(join(prefix, 'bin', 'opencode'))
  })

  test('a binary that appears after the first look is found by the next one, without a restart', () => {
    const at = scratch('later')
    const env = { HOME: at, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: '' }
    expect(PROGRAM.find(env).file).toBeNull()
    executable(join(at, '.opencode', 'bin', 'opencode'))
    expect(PROGRAM.find(env).file).toBe(join(at, '.opencode', 'bin', 'opencode'))
  })
})

describe('installing', () => {
  test('without admin rights: the vendor’s installer, told to leave the shell files alone, when there is no Homebrew', () => {
    const root = scratch('nobrew')
    const env = { HOME: root, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: '' }
    expect(hasBrew(env)).toBe(false)
    expect(PROGRAM.install(env)).toMatchObject({ line: CURL_LINE, lands: '~/.opencode/bin', source: 'https://opencode.ai/docs' })
    expect(CURL_LINE).toContain('--no-modify-path')
  })

  test('with Homebrew on PATH, or in a usual prefix, the project’s own tap', () => {
    const root = scratch('brew')
    tool(join(root, 'bin'), 'brew', 'exit 0')
    expect(PROGRAM.install({ HOME: root, PATH: join(root, 'bin'), KEHIKOT_OPENCODE_TOOL_DIRS: '' }).line).toBe(BREW_LINE)
    const prefix = scratch('prefix-brew')
    tool(prefix, 'brew', 'exit 0')
    expect(installFor({ HOME: root, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: prefix }).line).toBe('brew install anomalyco/tap/opencode')
  })

  test('never sudo', () => {
    for (const dirs of ['', '/nowhere']) expect(PROGRAM.install({ HOME, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: dirs }).line).not.toMatch(/sudo/)
  })

  test('is run with the places curl and brew live on its PATH', () => {
    const env = PROGRAM.installEnvironment({ PATH: '/usr/bin' })
    expect(env.PATH).toContain('/opt/homebrew/bin')
    expect(env.PATH!.startsWith('/usr/bin')).toBe(true)
  })

  test('a stand-in can be named by whoever started the server', () => {
    expect(PROGRAM.install({ KEHIKOT_OPENCODE_INSTALL_LINE: 'sh stand-in.sh' }).line).toBe('sh stand-in.sh')
  })
})

describe('when the install did not finish', () => {
  const noBrew = { HOME, PATH: '/usr/bin:/bin', KEHIKOT_OPENCODE_TOOL_DIRS: '' }

  test('a refusal to write is known through the terminal’s colours, and said plainly', () => {
    expect(deniedWrite('\u001b[1mEACC\u001b[0mES')).toBe(true)
    expect(deniedWrite('Error: permission denied, open')).toBe(true)
    expect(deniedWrite('404 Not Found')).toBe(false)
    expect(PROGRAM.explain('mkdir: /Users/x/.opencode: Permission denied', 1, CURL_LINE, noBrew)).toBe("The installer can't write where it was asked to. Check that the folder is yours, or install OpenCode another way: https://opencode.ai/docs")
  })

  test('other endings are said in a sentence with the next step', () => {
    expect(PROGRAM.explain('', 0, 'x', noBrew)).toContain('See the log')
    expect(PROGRAM.explain('sh: brew: command not found', 127, BREW_LINE, noBrew)).toContain('Homebrew was not found')
    expect(PROGRAM.explain('curl: (6) Could not resolve host: opencode.ai', 6, CURL_LINE, noBrew)).toContain('could not reach the internet')
    expect(PROGRAM.explain('boom', 7, BREW_LINE, noBrew)).toBe('The installer exited with 7. See the log, or run brew install anomalyco/tap/opencode in a terminal.')
  })
})
