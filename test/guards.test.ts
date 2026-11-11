import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlacedGuard } from 'kehikot-module-protocol'

import { GUARDS_FRESH_MS, HANDED_OFF, UNKNOWN, context, guard, guardAnswer, handedOff, type ContextNeeds, type GuardAnswer, type GuardNeeds } from '../context.ts'

/** What a guard answer does: its action, or the answer itself when it is none (null, or not known). */
const actionOf = (said: GuardAnswer | null | typeof UNKNOWN) => (said && said !== UNKNOWN ? said.action : said)
import { hostPlace, type DoorsAsked, type HostPlace } from '../doorConfig.ts'
import { answer } from '../doors.ts'

/**
 * Guards and subagent notes (protocol 2.61.0): the module decides, with the protocol's
 * `guardDecision`, what becomes of a shell command its session or a subagent is about to run, from
 * the guards of the modules placed on the session's kehikko; and says what a subagent is told at its
 * first prompt. The plugin's side is in plugin.test.ts.
 */

const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-opencode-guards-')))
afterAll(() => rmSync(project, { recursive: true, force: true }))

const SESSION = 'ses_0a1b2c3d4e5f6a7b8c9d0e1f2a'
const TOKEN = 'g'.repeat(32)

const QUEUE: PlacedGuard = {
  module: 'kehikot.queue',
  name: 'Test runs',
  guard: { id: 'heavy', tool: 'shell', match: { commands: ['bun test'], scripts: ['test'] }, action: 'rewrite', rewrite: 'kehikot-queue run -- sh -c {command}', why: 'Heavy runs wait their turn.' },
}
const NO_TSC: PlacedGuard = {
  module: 'kehikot.queue',
  name: 'Test runs',
  guard: { id: 'no-tsc', tool: 'shell', match: { commands: ['tsc'] }, allow: ['tsc --version'], action: 'deny', why: 'Typecheck through the queue.' },
}

const started = { projectPath: project, projectId: null, place: { epic: 'guards', parts: [], kehikko: { key: 'wide' } } }
const placed = (guards: PlacedGuard[] | undefined): HostPlace => ({ doors: [{ module: 'kehikko', name: 'kehikko' }] as HostPlace['doors'], modules: [], absent: null, everywhere: null, messages: null, messagesMore: 0, ...(guards ? { guards } : {}) })

describe('the answer to one shell command (guardAnswer)', () => {
  test('a rewrite runs the module’s command with the WHOLE original filled in, quoted; the words say so', () => {
    const said = guardAnswer("bun test --filter 'it''s'", [QUEUE])
    expect(said?.action).toBe('rewrite')
    if (said?.action !== 'rewrite') return
    /* Handed off: the bash tool waits for its command, so the queue returns at once and tells this session. */
    expect(said.command).toBe(`KEHIKOT_DETACH=1 kehikot-queue run -- sh -c 'bun test --filter '\\''it'\\'''\\''s'\\'''`)
    expect(said.says).toContain('Test runs (a module on this kehikko) ran this command through its own instead (guard heavy)')
    expect(said.says).toEndWith(HANDED_OFF)
    expect(HANDED_OFF).toContain("you'll be notified here when it finishes")
    /* With the session's place token, the queue knows whom to tell. */
    expect((guardAnswer('bun test', [QUEUE], false, TOKEN) as { command: string }).command).toBe(`KEHIKOT_DETACH=1 KEHIKOT_PLACE=${TOKEN} kehikot-queue run -- sh -c 'bun test'`)
    /* A script the guard names, through a package manager. */
    expect(guardAnswer('npm test', [QUEUE])?.action).toBe('rewrite')
  })

  test('a handed-off command runs in a shell with the hand-off and the place said to the command it runs, and nothing else changed', () => {
    const run = Bun.spawnSync(['sh', '-c', handedOff(`sh -c 'echo "$KEHIKOT_DETACH:$KEHIKOT_PLACE:$1"' - 'it'\\''s'`, TOKEN)])
    expect(run.stdout.toString()).toBe(`1:${TOKEN}:it's\n`)
    /* A token that is not one is left out; the hand-off is still asked. */
    expect(handedOff('x', 'no; rm -rf /')).toBe('KEHIKOT_DETACH=1 x')
    expect(handedOff('x', null)).toBe('KEHIKOT_DETACH=1 x')
  })

  test('a deny refuses with the module’s reason and the escape, and wins over a rewrite in the same line', () => {
    const said = guardAnswer('tsc --noEmit && bun test', [QUEUE, NO_TSC])
    expect(said).toEqual({ action: 'deny', says: expect.stringContaining('Refused by Test runs (a module on this kehikko), guard no-tsc: "Typecheck through the queue."') })
    expect(said?.says).toContain('KEHIKOT_DIRECT=1')
  })

  test('pass: another command, an allowed one, KEHIKOT_DIRECT in the line or the environment, no guards, no command', () => {
    expect(guardAnswer('ls -la', [QUEUE, NO_TSC])).toBeNull()
    expect(guardAnswer('tsc --version', [NO_TSC])).toBeNull()
    expect(guardAnswer('KEHIKOT_DIRECT=1 bun test', [QUEUE])).toBeNull()
    expect(guardAnswer('bun test', [QUEUE], true)).toBeNull()
    expect(guardAnswer('bun test', [])).toBeNull()
    expect(guardAnswer(undefined, [QUEUE])).toBeNull()
  })
})

describe('the guard door (guard): the guards of the modules placed on the session’s kehikko, kept 30 s', () => {
  const needs = (host: (asked: DoorsAsked) => Promise<HostPlace | null>, clock: { now: number }) => {
    const kept = new Map<string, { at: number; guards: PlacedGuard[] }>()
    const asked: DoorsAsked[] = []
    const n: GuardNeeds = {
      program: { isId: (id: string) => /^ses_/.test(id), settled: async () => null },
      startedOf: (token) => (token === TOKEN ? started : null),
      host: async (one) => {
        asked.push(one)
        return host(one)
      },
      keptGuards: (token) => kept.get(token) ?? null,
      keepGuards: (token, guards) => void kept.set(token, { at: clock.now, guards }),
      now: () => clock.now,
    }
    return { n, asked, kept }
  }

  test('asked of the host without messages, for the session’s kehikko; kept and used while fresh, asked again after', async () => {
    const clock = { now: 1_000 }
    let guards = [QUEUE]
    const { n, asked } = needs(async () => placed(guards), clock)
    const first = await guard({ session: SESSION, token: TOKEN, call: 'bun test' }, n)
    expect(actionOf(first)).toBe('rewrite')
    expect(asked).toEqual([{ projectPath: project, projectId: null, token: TOKEN, kehikko: 'wide', messages: false }])
    /* The module is taken off the kehikko: the host stops handing its guard. Within 30 s the kept list still holds. */
    guards = []
    clock.now += GUARDS_FRESH_MS - 1
    expect(actionOf(await guard({ session: SESSION, token: TOKEN, call: 'bun test' }, n))).toBe('rewrite')
    expect(asked).toHaveLength(1)
    clock.now += 2
    expect(await guard({ session: SESSION, token: TOKEN, call: 'bun test' }, n)).toBeNull()
    expect(asked).toHaveLength(2)
  })

  test('an old host that says no guards guards nothing; a host gone keeps what was kept; no token, a strange token, no command: nothing asked', async () => {
    const clock = { now: 0 }
    const old = needs(async () => placed(undefined), clock)
    expect(await guard({ session: SESSION, token: TOKEN, call: 'bun test' }, old.n)).toBeNull()

    const gone = needs(async () => null, clock)
    gone.kept.set(TOKEN, { at: -GUARDS_FRESH_MS * 2, guards: [NO_TSC] })
    expect(actionOf(await guard({ session: SESSION, token: TOKEN, call: 'tsc' }, gone.n))).toBe('deny')

    /* The host away (Kehikot restarting) and nothing kept: not known, so not "no guards" — /api/guard says 503 and the plugin asks again. */
    const away = needs(async () => null, clock)
    expect(await guard({ session: SESSION, token: TOKEN, call: 'tsc' }, away.n)).toBe(UNKNOWN)
    expect(away.kept.size).toBe(0)

    const none = needs(async () => placed([QUEUE]), clock)
    expect(await guard({ session: SESSION, token: null, call: 'bun test' }, none.n)).toBeNull()
    expect(await guard({ session: SESSION, token: 'x'.repeat(32), call: 'bun test' }, none.n)).toBeNull()
    expect(await guard({ session: SESSION, token: TOKEN, call: 42 }, none.n)).toBeNull()
    expect(await guard({ session: 'nope', token: TOKEN, call: 'bun test' }, none.n)).toBeNull()
    expect(none.asked).toHaveLength(0)
  })

  test('the door: POST only, the command from the body, 204 when it runs as written', async () => {
    expect((await answer('GET', '/api/guard', new URLSearchParams({ session: SESSION }), null, TOKEN))?.status).toBe(405)
    /* A token this process never gave out: nothing to hold the command to. */
    expect((await answer('POST', '/api/guard', new URLSearchParams({ session: SESSION }), { command: 'bun test' }, TOKEN))?.status).toBe(204)
  })
})

describe('what a subagent is told (SubagentStart)', () => {
  const needs = (host: (asked: DoorsAsked) => Promise<HostPlace | null>) => {
    const asked: DoorsAsked[] = []
    const kept: PlacedGuard[][] = []
    const told: string[] = []
    const n: ContextNeeds = {
      program: { isId: (id: string) => /^ses_/.test(id), settled: async () => null },
      startedOf: (token) => (token === TOKEN ? started : null),
      host: async (one) => {
        asked.push(one)
        return host(one)
      },
      doorsOf: () => null,
      toldFile: (token) => {
        told.push(token)
        return join(project, 'told.json')
      },
      told: () => {},
      log: () => {},
      keepGuards: (_token, guards) => void kept.push(guards),
    }
    return { n, asked, kept, told }
  }

  test('the place, the guards there; asked without messages, nothing filed, nothing kept of what was said', async () => {
    const { n, asked, kept, told } = needs(async () => placed([QUEUE, NO_TSC]))
    const said = await context({ event: 'SubagentStart', session: SESSION, token: TOKEN }, n)
    expect(said?.hookSpecificOutput.hookEventName).toBe('SubagentStart')
    const text = said?.hookSpecificOutput.additionalContext ?? ''
    expect(text).toContain('you are a subagent of a conversation that belongs to')
    expect(text).toContain('Heavy runs wait their turn.')
    expect(text).toContain('Typecheck through the queue.')
    expect(asked[0]?.messages).toBe(false)
    expect(kept).toEqual([[QUEUE, NO_TSC]])
    /* The session's record is read, for what changed since it was told (protocol 2.62.0), and never written. */
    expect(told).toEqual([TOKEN])
    expect(existsSync(join(project, 'told.json'))).toBe(false)
  })

  test('no host: the place all the same; a token this module did not give out: nothing', async () => {
    const { n } = needs(async () => null)
    expect((await context({ event: 'SubagentStart', session: SESSION, token: TOKEN }, n))?.hookSpecificOutput.additionalContext).toContain('subagent')
    expect(await context({ event: 'SubagentStart', session: SESSION, token: 'x'.repeat(32) }, n)).toBeNull()
  })
})

describe('the host’s answer (hostPlace)', () => {
  const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4999' }
  const asked: DoorsAsked = { projectPath: '/p', projectId: null, token: TOKEN, kehikko: 'wide' }
  const host = (more: Record<string, unknown>, bodies: Record<string, unknown>[]) =>
    (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return { ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN, doors: [], ...more }) }
    }) as unknown as typeof fetch

  test('guards parsed (a bad one dropped), null from a host too old to say; messages asked unless told not to', async () => {
    const bodies: Record<string, unknown>[] = []
    const now = await hostPlace(asked, { env, fetch: host({ guards: [QUEUE, { module: 'kehikot.x', name: 'X', guard: { id: 'bad' } }] }, bodies) })
    expect(now?.guards).toEqual([QUEUE])
    expect(bodies[0]?.messages).toBe(true)
    const older = await hostPlace({ ...asked, messages: false }, { env, fetch: host({}, bodies) })
    expect(older?.guards).toBeNull()
    expect(bodies[1]?.messages).toBe(false)
  })
})
