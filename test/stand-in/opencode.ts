/**
 * A stand-in for the OpenCode CLI, for tests: it takes the arguments and the configuration folder
 * this module passes, keeps its sessions where OpenCode 1.19.5 keeps them (its SQLite database),
 * loads the plugins of `OPENCODE_CONFIG_DIR` the way OpenCode does (every export called with the
 * plugin input), and fires their hooks and its bus events at the moments the real one does
 * (program.ts). It calls no model provider: an "answer" is a fixed line.
 *
 *   --version, --help          what `supports` reads. STANDIN_VERSION sets the version; STANDIN_OLD=1: no `--session`.
 *   [--session <id>] [--model m] [--agent a]   a session. A new one has no id until its first line, as the real one.
 *
 * Typed lines (one per line on standard input):
 *
 *   a line                 session.created (first line), chat.message, busy, the answer (message.updated), idle
 *   /ask                   busy, permission.asked; the next line answers: permission.replied, idle
 *   /question              busy, question.asked; the next line answers: question.replied, idle
 *   /task <words>          a child session "<words> (@explore subagent)": created, busy, idle
 *   /compact               session.compacted
 *   /new                   the next line starts a new session
 *   /interrupt             session.error (MessageAbortedError), idle
 *   /here <words>          the plugin's `kehikot_here` tool, as the model would call it
 *   /exit                  ends
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const out = (text: string) => process.stdout.write(text.replace(/\n/g, '\r\n'))

if (argv[0] === '--version') {
  out(`${process.env.STANDIN_VERSION ?? '1.19.5'}\n`)
  process.exit(0)
}
if (argv[0] === '--help') {
  out('opencode [project]\n\nstart opencode tui\n\nOptions:\n  -m, --model     model to use in the format of provider/model\n')
  if (!process.env.STANDIN_OLD) out('  -s, --session   session id to continue\n')
  out('      --agent     agent to use\n      --port      port to listen on\n')
  process.exit(0)
}

const flag = (name: string, short?: string): string | null => {
  const at = argv.findIndex((one) => one === name || (short !== undefined && one === short))
  return at >= 0 ? (argv[at + 1] ?? null) : null
}

/* Its database, where the real one keeps it. */
const data = join(process.env.XDG_DATA_HOME || join(process.env.HOME ?? '/tmp', '.local', 'share'), 'opencode')
mkdirSync(data, { recursive: true })
const db = new Database(process.env.OPENCODE_DB?.startsWith('/') ? process.env.OPENCODE_DB : join(data, 'opencode.db'))
db.run(`create table if not exists session (id text primary key, project_id text not null, parent_id text, slug text not null, directory text not null, title text not null, version text not null, cost real not null default 0, time_created integer not null, time_updated integer not null, time_archived integer)`)
db.run(`create table if not exists message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)`)
db.run(`create table if not exists part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)`)

let seq = 0
const idOf = (prefix: string) => `${prefix}_${Date.now().toString(16).padStart(12, '0')}${String(++seq).padStart(4, '0')}standin${Math.random().toString(36).slice(2, 8)}`

let session: string | null = flag('--session', '-s')
if (session && !db.query('select id from session where id = ?').get(session)) {
  out(`Error: Session not found: ${session}\n`)
  process.exit(1)
}

/* Its configuration folder, as OpenCode reads it: opencode.json, plugins/*.js, skills/<name>/SKILL.md. */
const dir = process.env.OPENCODE_CONFIG_DIR
const config = dir && existsSync(join(dir, 'opencode.json')) ? (JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8')) as { mcp?: Record<string, { url: string }>; permission?: unknown }) : {}
const skills = dir && existsSync(join(dir, 'skills')) ? readdirSync(join(dir, 'skills')).sort() : []

type Hooks = Record<string, any>
const hooks: Hooks[] = []
const prompted: string[] = []
const client = {
  session: {
    promptAsync: async (asked: { path: { id: string }; body: { parts: { text: string }[] } }) => {
      prompted.push(asked.body.parts.map((one) => one.text).join(''))
      out(`[prompt sent to ${asked.path.id}: ${asked.body.parts.map((one) => one.text).join('')}]\n`)
      await line(asked.body.parts.map((one) => one.text).join(''), asked.path.id)
      return {}
    },
  },
}
if (dir && existsSync(join(dir, 'plugins'))) {
  for (const name of readdirSync(join(dir, 'plugins')).filter((one) => /\.(js|ts)$/.test(one)).sort()) {
    const mod = (await import(pathToFileURL(join(dir, 'plugins', name)).href)) as Record<string, unknown>
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function') throw new TypeError('Plugin export is not a function')
      hooks.push(await (value as (input: unknown) => Promise<Hooks>)({ client, directory: process.cwd(), worktree: process.cwd(), project: {}, serverUrl: new URL('http://opencode.internal'), $: null }))
    }
  }
}

const trigger = async (name: string, input: unknown, output: unknown) => {
  for (const one of hooks) if (typeof one[name] === 'function') await one[name](input, output)
}
const event = async (type: string, properties: Record<string, unknown>) => {
  for (const one of hooks) if (typeof one.event === 'function') await one.event({ event: { id: idOf('evt'), type, properties } })
}

out(`OpenCode stand-in ${process.env.STANDIN_VERSION ?? '1.19.5'} in ${process.cwd()}${session ? ` on ${session}` : ''}\n`)
out(`doors: ${Object.keys(config.mcp ?? {}).sort().join(', ') || 'none'}\n`)
out(`skills: ${skills.join(', ') || 'none'}\n`)
out(`plugins: ${hooks.length}\n`)
if (flag('--model', '-m')) out(`model: ${flag('--model', '-m')}\n`)
if (flag('--agent')) out(`agent: ${flag('--agent')}\n`)
out('> ')

let waiting: 'permission' | 'question' | null = null
let fresh = false

async function ensure(): Promise<string> {
  if (session && !fresh) return session
  fresh = false
  session = idOf('ses')
  const now = Date.now()
  db.query(`insert into session (id, project_id, parent_id, slug, directory, title, version, cost, time_created, time_updated) values (?, 'global', null, 'slug', ?, ?, '1.19.5', 0, ?, ?)`).run(session, process.cwd(), `New session - ${new Date(now).toISOString()}`, now, now)
  await event('session.created', { info: { id: session, title: 'New session', directory: process.cwd() } })
  return session
}

async function answer(id: string): Promise<void> {
  const message = idOf('msg')
  const tokens = { input: 1200, output: 80, reasoning: 0, cache: { read: 3000, write: 0 } }
  db.query('update session set cost = cost + 0.01, time_updated = ? where id = ?').run(Date.now(), id)
  await event('message.updated', { info: { id: message, sessionID: id, role: 'assistant', time: { created: Date.now(), completed: Date.now() }, tokens, cost: 0.01, providerID: 'standin', modelID: 'echo-1' } })
  out('(stand-in answer)\n')
}

async function line(text: string, onto?: string): Promise<void> {
  const id = onto ?? (await ensure())
  const message = idOf('msg')
  const now = Date.now()
  const parts: Record<string, unknown>[] = [{ id: idOf('prt'), sessionID: id, messageID: message, type: 'text', text }]
  await trigger('chat.params', { sessionID: id, model: { limit: { context: 200000, output: 32000 } } }, {})
  await trigger('chat.message', { sessionID: id, messageID: message }, { message: { id: message, sessionID: id, role: 'user' }, parts })
  db.query('insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)').run(message, id, now, now, JSON.stringify({ role: 'user' }))
  for (const part of parts) db.query('insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)').run(String(part.id ?? idOf('prt')), message, id, now, now, JSON.stringify(part))
  db.query('update session set time_updated = ? where id = ?').run(now, id)
  const told = parts.filter((part) => part.synthetic)
  if (told.length) out(`[told: ${told.map((part) => String(part.text).split('\n')[0]).join(' | ')}]\n`)
  await event('session.status', { sessionID: id, status: { type: 'busy' } })
}

const idle = async (id: string) => {
  await event('session.status', { sessionID: id, status: { type: 'idle' } })
  await event('session.idle', { sessionID: id })
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  void drain()
})
process.stdin.on('end', () => process.exit(0))

let busy = false
async function drain(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (;;) {
      const at = buffer.search(/[\r\n]/)
      if (at < 0) break
      const typed = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (typed) await handle(typed)
    }
  } finally {
    busy = false
  }
}

async function handle(typed: string): Promise<void> {
  if (typed === '/exit') process.exit(0)
  if (waiting && session) {
    const id = session
    await event(waiting === 'permission' ? 'permission.replied' : 'question.replied', { sessionID: id, requestID: 'per_1', reply: 'once', answers: [] })
    waiting = null
    await answer(id)
    await idle(id)
    out('> ')
    return
  }
  if (typed === '/new' || typed === '/clear') {
    fresh = true
    out('(new session)\n> ')
    return
  }
  if (typed === '/compact') {
    if (session) await event('session.compacted', { sessionID: session })
    out('(compacted)\n> ')
    return
  }
  if (typed.startsWith('/here')) {
    const tool = hooks.map((one) => one.tool?.kehikot_here).find(Boolean)
    if (!tool) out('(no kehikot_here tool)\n> ')
    else out(`${await tool.execute({ say: typed.slice(5).trim() }, { sessionID: session ?? '' })}\n> `)
    return
  }
  if (typed.startsWith('/task')) {
    const id = await ensure()
    const child = idOf('ses')
    await event('session.created', { info: { id: child, parentID: id, title: `${typed.slice(5).trim()} (@explore subagent)` } })
    await event('session.status', { sessionID: child, status: { type: 'busy' } })
    await event('session.status', { sessionID: child, status: { type: 'idle' } })
    out('(subagent done)\n> ')
    return
  }
  if (typed === '/interrupt') {
    if (session) {
      await event('session.error', { sessionID: session, error: { name: 'MessageAbortedError', data: {} } })
      await idle(session)
    }
    out('(interrupted)\n> ')
    return
  }
  if (typed === '/ask' || typed === '/question') {
    await line(typed)
    const id = session!
    waiting = typed === '/ask' ? 'permission' : 'question'
    await event(waiting === 'permission' ? 'permission.asked' : 'question.asked', { id: 'per_1', sessionID: id, permission: 'bash', patterns: ['ls'], metadata: {}, always: [], questions: [] })
    out(waiting === 'permission' ? 'Allow? ' : 'Which one? ')
    return
  }
  await line(typed)
  const id = session!
  await trigger('tool.execute.after', { tool: 'read', sessionID: id, callID: 'c1', args: {} }, { title: '', output: '', metadata: {} })
  await answer(id)
  await idle(id)
  out('> ')
}
