import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TELL_ENV } from '../live.ts'
import { removeKit, serveFrom, servedOrigin, sessionKit } from '../skills.ts'
// @ts-expect-error: the plugin is plain JavaScript, as OpenCode loads it.
import { KehikotPlugin } from '../plugin/opencode/kehikot.js'

/**
 * The plugin a session is given (`plugin/opencode/kehikot.js`): called the way OpenCode calls a
 * plugin, with its hooks and bus events fired as OpenCode fires them, against a server that writes
 * down what it was sent. Then the same file loaded by the stand-in `opencode` from a session's own
 * folder, as a process.
 */

const RUN = 'ses_kehikot0123456789abcdef01234567'
const SESSION = 'ses_0a1b2c3d4e5f6a7b8c9d0e1f2a'
const CHILD = 'ses_0a1b2c3d4e5f6a7b8c9d0e1fff'
const SECRET = 'ab'.repeat(24)
const TOKEN = 'T'.repeat(43)

interface Heard {
  url: string
  ticket: string | undefined
}
const heard: Heard[] = []
let server: Server
let port = 0
const made: string[] = []
const scratch = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-opencode-plugin-')))
  made.push(dir)
  return dir
}

beforeAll(async () => {
  server = createServer((request, response) => {
    heard.push({ url: request.url ?? '', ticket: request.headers['x-module-ticket'] as string | undefined })
    const url = new URL(request.url ?? '/', 'http://x')
    if (url.pathname === '/api/context') {
      if (request.headers['x-module-ticket'] !== TOKEN) return void response.writeHead(204).end()
      response.setHeader('content-type', 'application/json')
      return void response.end(JSON.stringify({ hookSpecificOutput: { hookEventName: url.searchParams.get('event'), additionalContext: `Kehikot: told at ${url.searchParams.get('event')}` } }))
    }
    if (url.pathname === '/api/here') return void response.end(`Kehikot: Assigned (${url.searchParams.get('session')}, "${url.searchParams.get('say')}").\n`)
    response.writeHead(204).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})
afterAll(() => {
  server.close()
  for (const dir of made) removeKit(dir)
})

/** The `kehikot/` folder `sessionKit` writes beside the plugin: the token and the module's origin. */
function kitOf(token: string | null = TOKEN): string {
  const dir = scratch()
  mkdirSync(join(dir, 'kehikot'))
  if (token) writeFileSync(join(dir, 'kehikot', 'token'), token)
  writeFileSync(join(dir, 'kehikot', 'origin'), `http://127.0.0.1:${port}`)
  return join(dir, 'kehikot')
}
const env = (more: Record<string, string> = {}) => ({ [TELL_ENV.port]: String(port), [TELL_ENV.secret]: SECRET, [TELL_ENV.session]: RUN, KEHIKOT_OPENCODE_TOOLS: '1', ...more })
const words = () => heard.filter((one) => one.url.startsWith('/api/state')).map((one) => new URL(one.url, 'http://x').searchParams.get('event'))
const ev = (type: string, properties: Record<string, unknown>) => ({ event: { id: 'evt_1', type, properties } })

/** `fetch` as the plugin uses it, over node's http: the test document replaces the global one with a browser's. */
const nodeFetch = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Promise((done, fail) => {
    const req = httpRequest(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ ok: (response.statusCode ?? 0) < 300, status: response.statusCode, text: async () => body, json: async () => JSON.parse(body) }))
    })
    req.on('error', fail)
    req.end()
  })

async function plugin(more: { env?: Record<string, string>; kit?: string; client?: unknown; sayAfter?: number } = {}) {
  heard.length = 0
  return KehikotPlugin({ client: more.client ?? {} }, { env: more.env ?? env(), kit: more.kit ?? kitOf(), sayAfter: more.sayAfter ?? 0, fetch: nodeFetch })
}

describe('what the plugin says, and to whom', () => {
  test('a prompt is SessionStart then UserPromptSubmit, each one POST to this computer with the run, the conversation and the secret in a header', async () => {
    const hooks = await plugin()
    const output = { message: { id: 'msg_1' }, parts: [{ id: 'prt_0001', type: 'text', text: 'the person’s words, which are nobody else’s' }] }
    await hooks['chat.message']({ sessionID: SESSION }, output)
    const states = heard.filter((one) => one.url.startsWith('/api/state'))
    expect(states.map((one) => one.url)).toEqual([`/api/state?event=SessionStart&session=${RUN}&thread=${SESSION}`, `/api/state?event=UserPromptSubmit&session=${RUN}&thread=${SESSION}`])
    expect(states.every((one) => one.ticket === SECRET)).toBe(true)
    /* The prompt never leaves. */
    expect(JSON.stringify(heard)).not.toContain('nobody else')
  })

  test('what the module answers is added to the prompt as one synthetic part, after the person’s, in full first and then only what changed', async () => {
    const hooks = await plugin()
    const first = { message: { id: 'msg_1' }, parts: [{ id: 'prt_0001', type: 'text', text: 'hello' }] }
    await hooks['chat.message']({ sessionID: SESSION }, first)
    expect(first.parts).toHaveLength(2)
    expect(first.parts[1]).toMatchObject({ id: 'prt_0001kehikot', type: 'text', synthetic: true, sessionID: SESSION, messageID: 'msg_1', text: 'Kehikot: told at SessionStart\n\nKehikot: told at UserPromptSubmit' })
    expect(heard.filter((one) => one.url.startsWith('/api/context')).every((one) => one.ticket === TOKEN)).toBe(true)
    const second = { message: { id: 'msg_2' }, parts: [{ id: 'prt_0002', type: 'text', text: 'more' }] }
    await hooks['chat.message']({ sessionID: SESSION }, second)
    expect((second.parts[1] as { text: string }).text).toBe('Kehikot: told at UserPromptSubmit')
    /* After a compaction the next prompt is told in full again. */
    await hooks.event(ev('session.compacted', { sessionID: SESSION }))
    const third = { message: { id: 'msg_3' }, parts: [{ id: 'prt_0003', type: 'text', text: 'again' }] }
    await hooks['chat.message']({ sessionID: SESSION }, third)
    expect((third.parts[1] as { text: string }).text).toContain('told at SessionStart')
  })

  test('with no token there is nothing to be told with, and the prompt is left as it was', async () => {
    const hooks = await plugin({ kit: kitOf(null) })
    const output = { message: { id: 'msg_1' }, parts: [{ id: 'prt_0001', type: 'text', text: 'hello' }] }
    await hooks['chat.message']({ sessionID: SESSION }, output)
    expect(output.parts).toHaveLength(1)
  })

  test('OpenCode’s bus: working, an approval or a question on screen, back to work, an interrupt, finished — each change once', async () => {
    const hooks = await plugin()
    await hooks['tool.execute.after']({ tool: 'read', sessionID: SESSION, callID: 'c' })
    await hooks['tool.execute.after']({ tool: 'read', sessionID: SESSION, callID: 'd' })
    await hooks.event(ev('permission.asked', { id: 'per_1', sessionID: SESSION }))
    await hooks.event(ev('permission.replied', { sessionID: SESSION, requestID: 'per_1', reply: 'once' }))
    await hooks.event(ev('question.asked', { id: 'que_1', sessionID: SESSION, questions: [] }))
    await hooks.event(ev('question.rejected', { sessionID: SESSION, requestID: 'que_1' }))
    await hooks.event(ev('session.error', { sessionID: SESSION, error: { name: 'MessageAbortedError' } }))
    await hooks.event(ev('session.status', { sessionID: SESSION, status: { type: 'idle' } }))
    await hooks.event(ev('session.idle', { sessionID: SESSION }))
    expect(words()).toEqual(['PostToolUse', 'PermissionRequest', 'PostToolUse', 'AskUser', 'PostToolUse', 'Interrupt', 'Stop'])
  })

  test('a subagent is a child session: its start and finish carry its id, agent and task; what it asks for is said of the conversation it belongs to', async () => {
    const hooks = await plugin()
    await hooks.event(ev('session.created', { info: { id: CHILD, parentID: SESSION, title: 'Find where chimes play (@explore subagent)' } }))
    await hooks.event(ev('permission.asked', { id: 'per_2', sessionID: CHILD }))
    await hooks['tool.execute.after']({ tool: 'grep', sessionID: CHILD, callID: 'x' })
    await hooks.event(ev('session.status', { sessionID: CHILD, status: { type: 'busy' } }))
    await hooks.event(ev('session.status', { sessionID: CHILD, status: { type: 'idle' } }))
    await hooks.event(ev('session.idle', { sessionID: CHILD }))
    const urls = heard.map((one) => one.url)
    expect(urls).toEqual([
      `/api/state?event=SubagentStart&session=${RUN}&agent=${CHILD}&type=explore&task=Find+where+chimes+play`,
      `/api/state?event=PermissionRequest&session=${RUN}&thread=${SESSION}`,
      `/api/state?event=SubagentStop&session=${RUN}&agent=${CHILD}&type=explore&task=Find+where+chimes+play`,
    ])
    /* A child's prompt is never told the notes: the conversation it belongs to was. */
    const output = { message: { id: 'msg_9' }, parts: [] as unknown[] }
    await hooks['chat.message']({ sessionID: CHILD }, output)
    expect(output.parts).toEqual([])
  })

  test('an answer’s tokens, cost and model once per answer, with the window of the model asked', async () => {
    const hooks = await plugin()
    await hooks['chat.params']({ sessionID: SESSION, model: { limit: { context: 200000, output: 64000 } } }, {})
    const info = { id: 'msg_a', sessionID: SESSION, role: 'assistant', time: { created: 1, completed: 2 }, tokens: { input: 100, output: 20, reasoning: 3, cache: { read: 400, write: 5 } }, cost: 0.02, providerID: 'anthropic', modelID: 'claude-sonnet-5-5', summary: false }
    await hooks.event(ev('message.updated', { info }))
    await hooks.event(ev('message.updated', { info }))
    await hooks.event(ev('message.updated', { info: { ...info, id: 'msg_b', time: { created: 3 } } }))
    expect(heard.map((one) => one.url)).toEqual([`/api/state?event=Usage&session=${RUN}&thread=${SESSION}&input=100&output=20&reasoning=3&cacheRead=400&cacheWrite=5&cost=0.02&model=anthropic%2Fclaude-sonnet-5-5&window=200000&compactAt=168000`])
  })

  test('the tool `kehikot_here` posts this conversation’s own id, the person’s words and the run’s secret, and answers what the module says', async () => {
    const hooks = await plugin()
    expect(hooks.tool.kehikot_here.args).toEqual({ say: expect.objectContaining({ type: 'string' }) })
    const said = await hooks.tool.kehikot_here.execute({ say: 'own' }, { sessionID: SESSION })
    expect(said).toBe(`Kehikot: Assigned (${SESSION}, "own").\n`)
    const post = heard.find((one) => one.url.startsWith('/api/here'))!
    expect(post.ticket).toBe(SECRET)
    /* From a subagent, it is the conversation the subagent belongs to. */
    await hooks.event(ev('session.created', { info: { id: CHILD, parentID: SESSION, title: 'x (@general subagent)' } }))
    expect(await hooks.tool.kehikot_here.execute({ say: '' }, { sessionID: CHILD })).toContain(SESSION)
    /* A copy too old for a JSON-schema argument is given no tool. */
    expect((await plugin({ env: env({ KEHIKOT_OPENCODE_TOOLS: '' }) })).tool).toBeUndefined()
  })

  test('the one sentence for a conversation a restart cut off is sent once, through OpenCode’s own client, only when asked', async () => {
    const sent: unknown[] = []
    const client = { session: { promptAsync: async (asked: unknown) => void sent.push(asked) } }
    await plugin({ client, env: env({ KEHIKOT_OPENCODE_SAY: 'Kehikot restarted while you were working.', KEHIKOT_OPENCODE_SAY_TO: SESSION }) })
    await new Promise((done) => setTimeout(done, 20))
    expect(sent).toEqual([{ path: { id: SESSION }, body: { parts: [{ type: 'text', text: 'Kehikot restarted while you were working.' }] } }])
    sent.length = 0
    await plugin({ client })
    await new Promise((done) => setTimeout(done, 20))
    expect(sent).toEqual([])
  })

  test('every command the agent runs knows the conversation (for a skill written for Claude Code)', async () => {
    const hooks = await plugin()
    const output = { env: {} as Record<string, string> }
    await hooks['shell.env']({ cwd: '/x', sessionID: SESSION }, output)
    expect(output.env).toEqual({ KEHIKOT_OPENCODE_SESSION: SESSION })
  })

  test('with nobody listening, or no secret, it is silence: nothing thrown, nothing held up for long', async () => {
    const closed = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const dead = (closed.address() as AddressInfo).port
    await new Promise((done) => closed.close(done))
    const hooks = await plugin({ env: env({ [TELL_ENV.port]: String(dead) }) })
    const began = Date.now()
    await hooks.event(ev('session.status', { sessionID: SESSION, status: { type: 'idle' } }))
    const output = { message: { id: 'msg_1' }, parts: [{ id: 'prt_1', type: 'text', text: 'hi' }] }
    await hooks['chat.message']({ sessionID: SESSION }, output)
    expect(Date.now() - began).toBeLessThan(3000)
    const quiet = await plugin({ env: env({ [TELL_ENV.secret]: 'not hex' }) })
    await quiet.event(ev('session.status', { sessionID: SESSION, status: { type: 'idle' } }))
    expect(words()).toEqual([])
    /* An id that is not one is never sent. */
    const strict = await plugin()
    await strict.event(ev('session.status', { sessionID: '../../etc', status: { type: 'idle' } }))
    expect(words()).toEqual([])
  })
})

describe('loaded by OpenCode from a session’s own folder (the stand-in, as a process)', () => {
  test('its doors, skills and plugin are found; a line is reported and told; an approval is "needs you"; a subagent is said', async () => {
    const was = servedOrigin()
    serveFrom(`http://127.0.0.1:${port}`)
    const kit = await sessionKit([{ module: 'kehikot.notes', name: 'notes', url: 'http://127.0.0.1:9/mcp?kehikot-place=x', transport: 'http' }], { base: scratch(), token: TOKEN, fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch })
    serveFrom(was)
    const project = scratch()
    heard.length = 0
    const child = spawn(join(import.meta.dir, 'stand-in', 'opencode'), [], {
      cwd: project,
      env: { ...process.env, OPENCODE_CONFIG_DIR: kit.dir, ...env() },
    })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    const count = (what: string) => out.split(what).length - 1
    const until = async (what: string, times = 1) => {
      for (let i = 0; i < 400 && count(what) < times; i += 1) await new Promise((done) => setTimeout(done, 25))
      expect(count(what)).toBeGreaterThanOrEqual(times)
    }
    await until('plugins: 1')
    expect(out).toContain('doors: notes')
    expect(out).toContain('skills: kehikot-here')
    child.stdin.write('hello there\n')
    await until('(stand-in answer)')
    /* What the module answered reached the prompt, as a synthetic part. */
    expect(out).toContain('[told: Kehikot: told at SessionStart]')
    child.stdin.write('/ask\n')
    await until('Allow?')
    child.stdin.write('yes\n')
    await until('(stand-in answer)', 2)
    child.stdin.write('/task Audit the parser\n')
    await until('(subagent done)')
    child.stdin.write('/exit\n')
    await new Promise((done) => child.on('close', done))
    const said = words()
    expect(said.slice(0, 2)).toEqual(['SessionStart', 'UserPromptSubmit'])
    expect(said).toContain('PermissionRequest')
    expect(said).toContain('Stop')
    expect(said).toContain('Usage')
    expect(said).toContain('SubagentStop')
    expect(out).not.toContain('Error')
    removeKit(kit.dir)
  }, 20_000)
})
