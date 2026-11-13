import { describe, expect, test } from 'bun:test'
import { conversationsBringResult, conversationsFindResult, agentTaskStartResult, MANIFEST_KIND, servicesSchema } from 'kehikot-module-protocol'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BRING_PATH, FIND_PATH, START_PATH, bring, find, hostDoor, mentionIn, type AdoptNeeds } from '../adopt.ts'
import { MANIFEST } from '../manifest.ts'
import { Runs, headless, type Pty } from '../live.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, readPs, type Program, type Recorded } from '../program.ts'
import { assign, ignore, readPlaces, sighted, type NamedPlace } from '../record.ts'

/**
 * Adopting an item with the OpenCode conversation that worked on it (protocol 2.88.0, adopt.ts),
 * over fixtures: a stand-in session listing and records in scratch projects. Nothing here reads
 * OpenCode's real database or reaches a host.
 */

const A = 'ses_11111111111141118111111111111111'
const B = 'ses_22222222222242228222222222222222'
const C = 'ses_33333333333343338333333333333333'
const D = 'ses_44444444444444448444444444444444'
const KEY = 'k4072c9e5'
const THERE = { epic: 'thesis', parts: ['methods'], kehikko: KEY }
const ELSE = { epic: 'other', parts: [], kehikko: KEY }
const named = (place: { epic: string | null; parts: string[]; kehikko: string | null }): NamedPlace => ({ epic: place.epic, parts: place.parts, kehikko: place.kehikko ? { key: place.kehikko } : null })

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-opencode-adopt-')))

function needs(listing: Recorded[], options: { held?: string[]; running?: string[] } = {}) {
  const rehomed: { session: string; place: NamedPlace | null }[] = []
  const told: string[] = []
  const started: { projectPath: string; place: NamedPlace; brief: string; title: string }[] = []
  const program: AdoptNeeds['program'] = {
    name: 'OpenCode',
    isId: PROGRAM.isId,
    sessions: async (_projectPath, also = []) => listing.filter((one) => one.folder !== 'elsewhere' || also.includes(one.id)),
    find: () => ({ file: '/fake/bin/opencode', looked: [], usual: [] }),
    supports: PROGRAM.supports,
    active: async () => ({ known: true, active: (options.running ?? []).map((session) => ({ session, kind: 'interactive' as const, called: 'an OpenCode process', handle: null, pid: 7, cwd: '', startedAt: null, name: '' })) }),
  }
  const held = new Set(options.held ?? [])
  const given: AdoptNeeds = {
    program,
    holds: (session) => held.has(session),
    rehome: (session, place) => (rehomed.push({ session, place }), held.has(session)),
    told: (projectPath) => told.push(projectPath),
    start: async (projectPath, place, brief, title) => (started.push({ projectPath, place, brief, title }), { ok: true, session: D }),
    report: { env: { KEHIKOT_HOST: 'http://127.0.0.1:9' }, log: () => {} },
  }
  return { given, rehomed, told, started }
}

const rec = (id: string, label: string, lastActive: number, more: Partial<Recorded> = {}): Recorded => ({ id, label, firstPrompt: label, lastPrompt: '', lastActive, ...more })

describe('find: what the session listing can say', () => {
  test('a conversation that names the ref is `mentioned`; the others that ran here are `folder`, strongest then newest', async () => {
    const dir = project()
    const listing = [
      rec(A, 'tidy the docs', 300, { folder: dir }),
      rec(B, 'review !4721 before merge', 100, { folder: dir }),
      rec(C, 'something else', 200, { folder: dir, lastPrompt: 'push feat/adopt and open the MR' }),
    ]
    assign(dir, named(THERE), A)
    const { given } = needs(listing, { running: [A] })
    const found = await find({ project: dir, refs: ['!4721'], branch: 'feat/adopt' }, given)
    expect(conversationsFindResult.parse({ conversations: found }).conversations).toHaveLength(3)
    expect(found.map((one) => [one.session, one.match, one.reason])).toEqual([
      [C, 'mentioned', 'mentioned branch feat/adopt'],
      [B, 'mentioned', 'mentioned !4721'],
      [A, 'folder', 'worked in this repository'],
    ])
    expect(found.find((one) => one.session === A)).toMatchObject({ place: THERE, running: true, title: 'tidy the docs', folder: dir })
    expect(found.find((one) => one.session === B)).toMatchObject({ place: null, running: false })
  })

  test('titles and reasons only: no prompt text is in an answer', async () => {
    const dir = project()
    const { given } = needs([rec(A, 'short title', 1, { firstPrompt: 'short title', lastPrompt: 'a secret plan for !4721' })])
    const found = await find({ project: dir, refs: ['!4721'] }, given)
    expect(JSON.stringify(found)).not.toContain('secret')
    expect(found[0]).toMatchObject({ match: 'mentioned', reason: 'mentioned !4721' })
  })

  test('a ref inside a longer number, or a bare number, is no mention', () => {
    expect(mentionIn(['see !47210'], { refs: ['!4721'] })).toBeNull()
    expect(mentionIn(['4721 apples'], { refs: ['4721'] })).toBeNull()
    expect(mentionIn(['(#12)'], { refs: ['#12'] })).toBe('mentioned #12')
    expect(mentionIn(['on feat/adopt-later'], { refs: ['!1'], branch: 'feat/adopt' })).toBeNull()
    expect(mentionIn(['https://x.example/r/-/merge_requests/9 done'], { refs: ['!9x'], url: 'https://x.example/r/-/merge_requests/9' })).toBe('mentioned https://x.example/r/-/merge_requests/9')
  })

  test('a conversation a person said is no Kehikot one is never offered', async () => {
    const dir = project()
    sighted(dir, A, 'agents')
    ignore(dir, A)
    const { given } = needs([rec(A, 'mentions !5', 1), rec(B, 'mentions !5 too', 2)])
    expect((await find({ project: dir, refs: ['!5'] }, given)).map((one) => one.session)).toEqual([B])
  })

  test('at most 20, and nothing for a folder that is not there', async () => {
    const dir = project()
    const many = Array.from({ length: 30 }, (_, i) => rec(`ses_${String(i).padStart(12, 'a')}`, `n ${i}`, i))
    const { given } = needs(many)
    expect(await find({ project: dir, refs: ['!1x'] }, given)).toHaveLength(20)
    expect(await find({ project: join(dir, 'gone'), refs: ['!1'] }, given)).toEqual([])
  })
})

describe('bring: a compare-and-set of one conversation’s place', () => {
  test('an unplaced conversation is filed under the place, as /kehikot-here files it', async () => {
    const dir = project()
    const { given, told } = needs([rec(A, 'x', 1)])
    const said = conversationsBringResult.parse(await bring({ project: dir, session: A, to: THERE, from: null }, given))
    expect(said).toEqual({ outcome: 'brought', place: THERE, resumed: false, why: '' })
    const read = readPlaces(dir)
    expect(read.ok && read.value.sessions[A]?.home).toBe(placeKey(named(THERE)))
    /* Its token, as `/kehikot-here` gives one. */
    expect(read.ok && read.value.sessions[A]?.token).toBeTruthy()
    expect(told).toEqual([dir])
  })

  test('one filed under another place is never moved: `elsewhere`, with where it is, and the record untouched', async () => {
    const dir = project()
    assign(dir, named(ELSE), A)
    const before = JSON.stringify(readPlaces(dir))
    const { given } = needs([rec(A, 'x', 1)])
    expect(await bring({ project: dir, session: A, to: THERE, from: null }, given)).toMatchObject({ outcome: 'elsewhere', place: ELSE })
    expect(JSON.stringify(readPlaces(dir))).toBe(before)
  })

  test('undo: `to: null, from: <place>` takes it back off, and only while it is still there', async () => {
    const dir = project()
    const { given } = needs([rec(A, 'x', 1)])
    await bring({ project: dir, session: A, to: THERE, from: null }, given)
    expect(await bring({ project: dir, session: A, to: null, from: THERE }, given)).toMatchObject({ outcome: 'brought', place: null })
    const read = readPlaces(dir)
    expect(read.ok && read.value.sessions[A]?.home).toBeUndefined()
    expect(read.ok && Object.values(read.value.places).some((entry) => entry.sessions.includes(A))).toBe(false)
    /* Moved by somebody since: the undo takes nothing back. */
    assign(dir, named(ELSE), A)
    expect(await bring({ project: dir, session: A, to: null, from: THERE }, given)).toMatchObject({ outcome: 'elsewhere', place: ELSE })
  })

  test('a conversation this process holds gains the place at once: `resumed`, and nothing restarted', async () => {
    const dir = project()
    const { given, rehomed } = needs([rec(A, 'x', 1)], { held: [A] })
    expect(await bring({ project: dir, session: A, to: THERE, from: null }, given)).toMatchObject({ outcome: 'brought', resumed: true })
    expect(rehomed).toEqual([{ session: A, place: named(THERE) }])
  })

  test('an id OpenCode has no conversation by in this project, or not an id, is `no-such-session`', async () => {
    const dir = project()
    const { given } = needs([rec(A, 'x', 1)])
    expect(await bring({ project: dir, session: B, to: THERE, from: null }, given)).toMatchObject({ outcome: 'no-such-session' })
    expect(await bring({ project: dir, session: '../x', to: THERE, from: null }, given)).toMatchObject({ outcome: 'no-such-session' })
  })
})

describe('the door: only Kehikot’s own server', () => {
  const PASS = 'p'.repeat(40)
  const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4170' }
  const minting = (minted: boolean) => (async (url: string | URL | Request) => {
    expect(String(url)).toBe(`http://127.0.0.1:4170/host/server-pass?pass=${PASS}`)
    return Response.json({ ok: true, minted })
  }) as unknown as typeof fetch
  const post = (path: string, body: unknown, headers: Record<string, string>) => {
    const request = new Request(`http://127.0.0.1:4110${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { request, info: { asker: 'program' as const, url: new URL(request.url), ticket: null } }
  }
  const HOST = { 'x-kehikot-caller': 'kehikko', 'x-kehikot-pass': PASS }

  test('a request without the host’s caller and pass, or with a pass the host did not mint, is refused with 403 on every route', async () => {
    const dir = project()
    const { given, started } = needs([rec(A, 'x', 1)])
    for (const path of [FIND_PATH, BRING_PATH, START_PATH]) {
      const body = path === FIND_PATH ? { project: dir, refs: ['!1'] } : path === BRING_PATH ? { project: dir, session: A, to: THERE, from: null } : { project: dir, brief: 'b', place: null, title: 't' }
      for (const [headers, minted] of [[{}, true], [{ 'x-kehikot-caller': 'kehikot.claude', 'x-kehikot-pass': PASS }, true], [HOST, false]] as const) {
        const door = hostDoor(() => given, { env, fetch: minting(minted) })
        const { request, info } = post(path, body, headers)
        const answer = await door(request, info)
        expect(answer?.status).toBe(403)
      }
    }
    expect(started).toEqual([])
    expect(readPlaces(dir).ok && (readPlaces(dir) as { value: { sessions: object } }).value.sessions).toEqual({})
  })

  test('vouched for: find, bring and start answer what the protocol reads', async () => {
    const dir = project()
    const { given, started } = needs([rec(A, 'fix !7', 1)])
    const door = hostDoor(() => given, { env, fetch: minting(true) })
    const ask = async (path: string, body: unknown) => {
      const { request, info } = post(path, body, HOST)
      const answer = await door(request, info)
      expect(answer?.status).toBe(200)
      return answer!.json()
    }
    expect(conversationsFindResult.parse(await ask(FIND_PATH, { project: dir, refs: ['!7'] })).conversations[0]).toMatchObject({ session: A, match: 'mentioned' })
    expect(conversationsBringResult.parse(await ask(BRING_PATH, { project: dir, session: A, to: THERE, from: null })).outcome).toBe('brought')
    /* Accepted at once (protocol 2.99.0), under the id its run will have; started after the answer. */
    const accepted = agentTaskStartResult.parse(await ask(START_PATH, { project: dir, brief: 'Adopt !7', place: THERE, title: 'Adopt' }))
    expect(accepted).toMatchObject({ outcome: 'started', why: '', pending: true })
    expect(PROGRAM.isId(accepted.session!) || /^[0-9a-f-]{36}$/.test(accepted.session!)).toBe(true)
    await new Promise((done) => setTimeout(done, 20))
    expect(started).toEqual([{ projectPath: dir, place: named(THERE), brief: 'Adopt !7', title: 'Adopt' }])
  })

  test('other paths are not this door’s, and a GET is refused', async () => {
    const { given } = needs([])
    const door = hostDoor(() => given, { env, fetch: minting(true) })
    const other = new Request('http://127.0.0.1:4110/api/place', { method: 'GET' })
    expect(await door(other, { asker: 'page', url: new URL(other.url), ticket: null })).toBeUndefined()
    const get = new Request(`http://127.0.0.1:4110${FIND_PATH}`, { method: 'GET' })
    expect((await door(get, { asker: 'page', url: new URL(get.url), ticket: null }))?.status).toBe(405)
  })
})

describe('the manifest', () => {
  test('provides conversations.finder and agent.tasks, as the protocol reads them', () => {
    expect(MANIFEST.kind).toBe(MANIFEST_KIND)
    const services = servicesSchema.parse(MANIFEST.services)
    expect(services['conversations.finder']).toEqual({ name: 'OpenCode', program: 'OpenCode', find: FIND_PATH, bring: BRING_PATH })
    expect(services['agent.tasks']).toEqual({ name: 'OpenCode', program: 'OpenCode', start: START_PATH, view: '/app?session={session}' })
  })
})

describe('start: a new conversation fed the brief, the way a place starts one', () => {
  class FakePty implements Pty {
    pid = 4242
    typed: string[] = []
    heard: (chunk: string) => void = () => {}
    constructor(readonly args: string[]) {}
    onData(heard: (chunk: string) => void) {
      this.heard = heard
    }
    onExit() {}
    write(data: string) {
      this.typed.push(data)
    }
    resize() {}
    kill() {}
  }

  function world() {
    const held = new Map<string, Recorded[]>()
    const ptys: FakePty[] = []
    const program: Program = {
      ...PROGRAM,
      find: () => ({ file: '/fake/bin/opencode', looked: [], usual: [] }),
      supports: async () => ({ ok: true, missing: null, tells: false, lists: true, configures: false }),
      active: async () => ({ known: true, active: [] }),
      newId: () => B,
      /* OpenCode names the conversation C once the brief is sent. */
      settled: async (projectPath, id) => (id === B && held.get(projectPath)?.some((one) => one.id === C) ? C : held.get(projectPath)?.some((one) => one.id === id) ? id : null),
      sessions: async (projectPath) => held.get(projectPath) ?? [],
      environment: () => ({ PATH: '/bin' }),
    }
    const runs = new Runs({ program, port: () => null, every: null, watchEvery: null, log: () => {}, screen: headless, taskWait: 2_000, spawn: (_file, args) => {
      const pty = new FakePty(args)
      ptys.push(pty)
      return pty
    } })
    return { runs, ptys, names: (dir: string) => held.set(dir, [{ id: C, label: 'Adopt !7', lastActive: 5 }]) }
  }

  test('OpenCode is started with the brief as its first prompt, last; the id it names is answered, and the conversation is filed under the place', async () => {
    const dir = project()
    const w = world()
    const started = w.runs.startTask(dir, named(THERE), 'Adopt !7 and carry on', 'Adopt')
    await new Promise((done) => setTimeout(done, 50))
    expect(w.ptys).toHaveLength(1)
    expect(w.ptys[0]!.args.slice(-2)).toEqual(['--prompt', 'Adopt !7 and carry on'])
    /* Nothing typed: the brief is OpenCode's own first prompt. */
    expect(w.ptys[0]!.typed).toEqual([])
    w.names(dir)
    expect(await started).toEqual({ ok: true, session: C })
    const read = readPlaces(dir)
    expect(read.ok && read.value.sessions[C]?.home).toBe(placeKey(named(THERE)))
    expect(w.runs.taskView(C)).toMatchObject({ projectPath: dir, place: { epic: 'thesis', parts: ['methods'] } })
  })

  test('at project level (place null) it is filed under the project, no epic', async () => {
    const dir = project()
    const w = world()
    const started = w.runs.startTask(dir, { epic: null, parts: [], kehikko: null }, 'brief', '')
    await new Promise((done) => setTimeout(done, 50))
    w.names(dir)
    expect(await started).toEqual({ ok: true, session: C })
    const read = readPlaces(dir)
    expect(read.ok && read.value.sessions[C]?.home).toBe('epic=-;parts=-;kehikko=-')
  })

  test('a conversation OpenCode never names in time, still running, is under way under its run’s id (protocol 2.99.0)', async () => {
    const dir = project()
    const w = world()
    const said = await w.runs.startTask(dir, named(THERE), 'brief', 't', 'ses_kehikotgiven0000000000000000')
    expect(said).toEqual({ ok: true, session: 'ses_kehikotgiven0000000000000000' })
  })

  test('the words of a brief are never read as a process’s session (`readPs`)', () => {
    expect([...readPs(`  77 /usr/local/bin/opencode --prompt please run --session ${A}\n  78 /usr/local/bin/opencode --session ${B}`).keys()]).toEqual([B])
  })
})

describe('the view: one conversation on its own', () => {
  test('`/app?session=<id>` names the conversation; anything else names none', async () => {
    const { taskSession } = await import('../src/view/task-view.tsx')
    expect(taskSession(`?session=${A}`)).toBe(A)
    expect(taskSession('?session=../x')).toBeNull()
    expect(taskSession('')).toBeNull()
  })
})
