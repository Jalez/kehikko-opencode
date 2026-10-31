import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { personEnv } from 'kehikot-module-protocol/serve'

/**
 * The program this module opens, and everything that is specific to it.
 *
 * ## This is the only file that knows it is OpenCode
 *
 * The rest of the module is a terminal that holds one session per place: a pty, a record of
 * which session belongs where, a list to choose from. Everything that knows the program is the
 * OpenCode CLI (`opencode`, anomalyco/opencode, formerly sst/opencode) is here, as one value of one
 * interface — `Program`, the same interface the Claude and Codex modules answer for theirs.
 *
 * What a program has to answer, and it is the whole list:
 *
 *  1. **Where is the binary?** (`find`) The desktop app starts modules with a thin PATH.
 *  2. **Can this copy do what is asked of it?** (`supports`)
 *  3. **How is a new session started, and how is one resumed?** (`fresh`, `resume`) As argv.
 *  4. **Does a session exist yet, and under which id?** (`settled`) OpenCode chooses a new
 *     session's id itself (`ses_…`) and creates it at the first prompt; the session's own plugin
 *     then names it (`learnSession`).
 *  5. **Which sessions does it hold for a folder?** (`sessions`) Read from its database.
 *  6. **How is it installed?** (`install`)
 *  7. **Can it say what it is doing?** (`signal`) Through the plugin this module gives each
 *     session for its one process (`plugin/opencode/kehikot.js`), which hears OpenCode's own bus.
 *  8. **Is a session already open in another process?** (`active`) OpenCode holds no lock per
 *     session; a process started on one (`--session <id>`) says so in its arguments.
 *
 * ## What is never here
 *
 * A prompt of anybody's but the person's: the person types. The one sentence this module ever
 * sends is its own, fixed, to a conversation a restart cut off mid-turn, when the person opens it
 * again, behind a setting they can turn off (`RESUME_LINE` in live.ts). And no flag that widens
 * what the program may do: no `--auto` (which approves every permission not denied), nothing that
 * lowers a permission the person set. A session opened here can do exactly what `opencode` would
 * do in any terminal in that folder, plus the doors and skills of its kehikko.
 *
 * ## Every command line this module ever runs, and it is the whole list
 *
 *     opencode --version                               once per binary: which release
 *     opencode --help                                  once per binary: which options it has
 *     opencode [--model <m>] [--agent <a>]             a new session (TUI, in the project's folder)
 *     opencode --session <ses_…> [--model …] [--agent …]   a session nothing else holds
 *     /usr/bin/sqlite3 -readonly -json <its db> <select>   the sessions of a folder: reads
 *     /bin/ps -axo pid=,command=                       which processes were started on which session: reads
 *
 * Everything per session rides on ONE environment variable, `OPENCODE_CONFIG_DIR`, which OpenCode
 * reads as one more configuration folder after the person's own (anomalyco/opencode
 * `config/paths.ts`, read at v1.19.5): its `opencode.json` (the doors, as `mcp`), its `plugins/`
 * (this module's plugin), its `skills/` (the kehikko's skills). Nothing of the person's
 * configuration is written. Read against the source at v1.19.5 and its docs at opencode.ai; the
 * tests run a stand-in, never a model provider.
 */

export interface Found {
  /** The binary, absolute, or null when no candidate is an executable file. */
  file: string | null
  /** Every directory looked in, in the order it was looked in. */
  looked: string[]
  /** The ones among them that are not from PATH: the usual places an install lands. */
  usual: string[]
}

export interface Able {
  ok: boolean
  /** What this copy lacks, for the sentence on screen. Null when ok, or when nothing could be told. */
  missing: string | null
  /** Whether this copy loads the plugin from a per-run folder: how a session says what it is doing. */
  tells: boolean
  /** Whether this copy can be asked which process was started on which session (its arguments). */
  lists: boolean
  /** Whether this copy takes a display name for a session. OpenCode does not, at start. */
  names?: boolean
  /** Whether this copy takes a configuration folder for one process (`OPENCODE_CONFIG_DIR`): how a session is given its place. */
  configures?: boolean
  /** Whether a session can be given this module's skills (`skills/` in that folder). */
  plugins?: boolean
  /** Whether this copy runs a session in the background that outlives this process. Not as this module starts it. */
  backgrounds?: boolean
  /** Whether the plugin may give OpenCode a tool with a JSON-schema argument (`kehikot_here`): 1.14.49 and later. */
  tools?: boolean
  /** The release, as `--version` said it; null when it could not be read. */
  version?: string | null
}

/** A session started or woken in the background, or why not. OpenCode never is: the type stays for the interface. */
export type Backgrounded = { ok: true; handle: string; active: Active } | { ok: false; why: string }

/**
 * One conversation a process holds now, as far as can be told: an `opencode` process started with
 * `--session <id>` (or `-s`). A process started with no id and on a conversation since is not
 * seen; OpenCode keeps no lock per conversation to ask (it writes one database for all of them).
 */
export interface Active {
  session: string
  /** Always `interactive` for OpenCode as found: nothing it runs here can be attached to. */
  kind: 'background' | 'interactive' | 'other'
  called: string
  /** What `attach` would take. Null. */
  handle: string | null
  pid: number | null
  cwd: string
  startedAt: number | null
  name: string
  state?: State | null
  status?: ActiveStatus | null
}

export type ActiveStatus = 'idle' | 'busy' | 'waiting' | 'shell'

export type Running = { known: true; active: Active[] } | { known: false; why: 'too-old' | 'failed' }

/** What a session is doing, as far as its program says. */
export type State = 'working' | 'needs-you' | 'finished'
export const STATES: readonly State[] = ['working', 'needs-you', 'finished']

/** One session as the program's own records describe it. */
export interface Recorded {
  id: string
  /** What the session is called: its title, or its first prompt while it has OpenCode's default title. `''` when nothing readable was found. */
  label: string
  firstPrompt?: string
  lastPrompt?: string
  prs?: { number: number; url: string }[]
  /** The sessions this conversation was carried on in. OpenCode resumes a conversation under its own id, so none. */
  next?: string[]
  /** When the record last changed, in milliseconds. */
  lastActive: number
  /** What the conversation cost, as OpenCode summed it (its `session.cost`); 0 for nothing priced. */
  cost?: number
}

export interface Install {
  line: string
  lands: string
  source: string
  checked: string
}

export interface Program {
  name: string
  binary: string
  find(env?: NodeJS.ProcessEnv): Found
  supports(file: string): Promise<Able>
  newId(): string
  isId(id: string): boolean
  fresh(id: string, name?: string): string[]
  resume(id: string, name?: string, line?: string): string[]
  settled(projectPath: string, id: string, since: number): Promise<string | null>
  sessions(projectPath: string, also?: readonly string[]): Promise<Recorded[]>
  install(env?: NodeJS.ProcessEnv): Install
  /** The environment the installer runs in: the one given, with the places `curl` and `brew` live added to PATH. */
  installEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** What to tell the person when the installer ended without a binary: plain words and the next step. */
  explain(output: string, exitCode: number, ran: string, env?: NodeJS.ProcessEnv): string
  environment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  signal(event: string): State | null
  active(file: string, env?: NodeJS.ProcessEnv): Promise<Running>
}

/* ------------------------------------------------------------------------ *
 * OpenCode
 * ------------------------------------------------------------------------ */

const BINARY = 'opencode'

/** The home folder as the environment names it, which is what the program itself goes by. */
export function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || homedir()
}

/**
 * Where OpenCode keeps its data: `$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`
 * (`xdg-basedir`, as OpenCode's `core/global.ts` uses it). Read, never written: its database, and
 * nothing else. `auth.json` beside it holds the person's provider keys and is never opened.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.startsWith('/') ? env.XDG_DATA_HOME : join(home(env), '.local', 'share')
  return join(xdg, 'opencode')
}

/**
 * OpenCode's database: `OPENCODE_DB` when it names one (absolute, or a name in the data folder —
 * the variable the program honours), else `opencode.db` in the data folder (a release from the
 * `latest`, `beta` or `prod` channel; a development build writes `opencode-<channel>.db`).
 */
export function databaseFile(env: NodeJS.ProcessEnv = process.env): string {
  const said = env.OPENCODE_DB
  if (said && said !== ':memory:') return said.startsWith('/') ? said : join(dataDir(env), said)
  return join(dataDir(env), 'opencode.db')
}

/**
 * The places an install usually lands that a thin PATH leaves out: the installer's own folder
 * (`~/.opencode/bin`), `~/.local/bin`, Homebrew's, npm's and Bun's global bins.
 */
function usualDirs(env: NodeJS.ProcessEnv): string[] {
  const at = home(env)
  return [
    join(at, '.opencode', 'bin'),
    join(at, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(at, '.npm-global', 'bin'),
    join(at, '.bun', 'bin'),
  ]
}

/** PATH with the usual places added after it, so `curl`, `bash` and `brew` are found under the desktop app's thin one. */
function installPath(env: NodeJS.ProcessEnv): string {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...toolDirs(env), '/usr/bin', '/bin']
  return [...new Set(dirs)].join(delimiter)
}

/**
 * Where `brew` and `npm` usually are: Homebrew's two prefixes. `KEHIKOT_OPENCODE_TOOL_DIRS` (a
 * PATH-style list, empty for none) replaces them, which is how a test keeps this machine's real
 * Homebrew and npm out of what it checks.
 */
function toolDirs(env: NodeJS.ProcessEnv): string[] {
  const said = env.KEHIKOT_OPENCODE_TOOL_DIRS
  return said === undefined ? ['/opt/homebrew/bin', '/usr/local/bin'] : said.split(delimiter).filter(Boolean)
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The native binary behind an npm launcher, when `file` is one.
 *
 * npm installs `opencode` (package `opencode-ai`) as a link to `opencode-ai/bin/opencode`, a Node
 * script (`#!/usr/bin/env node`) that only finds and runs the native binary of
 * `opencode-<platform>-<arch>` (and keeps a copy beside itself, `bin/.opencode`). Under the desktop
 * app's thin PATH there may be no `node` to run it with, so the binary is run directly: the same
 * program, without the hop — and the process this module holds is OpenCode's own. Anything else is
 * returned as it was.
 */
export function nativeOf(file: string): string {
  let real = file
  try {
    real = realpathSync(file)
  } catch {
    return file
  }
  if (!real.endsWith(join('opencode-ai', 'bin', 'opencode'))) return file
  let head = ''
  try {
    head = readFileSync(real, { encoding: 'utf8', flag: 'r' }).slice(0, 64)
  } catch {
    return file
  }
  if (!head.startsWith('#!')) return file
  const cached = join(dirname(real), '.opencode')
  if (runnable(cached)) return cached
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const base = `opencode-${platform}-${process.arch}`
  const pkg = dirname(dirname(real))
  for (const modules of [join(pkg, 'node_modules'), dirname(pkg)]) {
    for (const name of [base, `${base}-baseline`]) {
      const candidate = join(modules, name, 'bin', BINARY)
      if (runnable(candidate)) return candidate
    }
  }
  return file
}

/** npm's global prefix as `npm prefix -g` says it, asked at most every few seconds; null when npm cannot say. */
const prefixes = new Map<string, { at: number; prefix: string | null }>()
const PREFIX_FOR = 5_000

export function npmPrefix(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = `${home(env)}\0${env.PATH ?? ''}`
  const known = prefixes.get(key)
  if (known && Date.now() - known.at < PREFIX_FOR) return known.prefix
  let prefix: string | null = null
  try {
    const said = execFileSync('npm', ['prefix', '-g'], {
      /* npm is a Node script: the person's `node`, not Bun's shim of the host. */
      env: { ...personEnv(env), PATH: installPath(personEnv(env)) },
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    prefix = said.startsWith('/') ? said : null
  } catch {
    prefix = null
  }
  prefixes.set(key, { at: Date.now(), prefix })
  return prefix
}

function find(env: NodeJS.ProcessEnv = process.env): Found {
  const looked: string[] = []
  const usual = usualDirs(env)
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...usual]
  for (const dir of dirs) {
    if (looked.includes(dir)) continue
    looked.push(dir)
    const file = join(dir, BINARY)
    if (runnable(file)) return { file: nativeOf(file), looked, usual }
  }
  /* Last, because it costs a process: where npm itself puts a global install. */
  const prefix = npmPrefix(env)
  if (prefix) {
    const dir = join(prefix, 'bin')
    if (!looked.includes(dir)) {
      looked.push(dir)
      usual.push(dir)
      const file = join(dir, BINARY)
      if (runnable(file)) return { file: nativeOf(file), looked, usual }
    }
  }
  return { file: null, looked, usual }
}

/**
 * The option a resumed session needs, checked against `opencode --help` (yargs, v1.19.5), not
 * written from memory:
 *
 *     -s, --session   session id to continue
 */
const NEEDS: readonly { said: string; test: RegExp }[] = [{ said: '--session', test: /--session\b/ }]

/** The release a version line names: `1.19.5` out of `1.19.5` or `opencode 1.19.5`. */
export function versionOf(text: string): [number, number, number] | null {
  const said = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return said ? [Number(said[1]), Number(said[2]), Number(said[3])] : null
}

const atLeast = (v: [number, number, number], floor: [number, number, number]): boolean => {
  for (let i = 0; i < 3; i += 1) if (v[i] !== floor[i]) return v[i]! > floor[i]!
  return true
}

/**
 * The release from which a per-run folder carries everything a session is given: `plugins/`,
 * `skills/` and `opencode.json` in `OPENCODE_CONFIG_DIR` (all read by 1.x). An older copy is
 * started as it would be in a terminal, with no doors, skills or state.
 */
const CONFIG_DIR_FROM: [number, number, number] = [1, 0, 0]
/** Plugin tools whose arguments are plain JSON Schema (`legacyJsonSchema`), from 1.14.49 (#27451). */
const TOOLS_FROM: [number, number, number] = [1, 14, 49]

const able = new Map<string, Able>()

/**
 * What the program prints for a command that only answers, read through a real pipe, whole.
 * Standard input closed; `''` for anything that went wrong.
 */
function answered(file: string, args: readonly string[], env?: NodeJS.ProcessEnv, more: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((done) => {
    const child = execFile('/bin/sh', ['-c', '"$0" "$@" </dev/null 2>&1 | /bin/cat', file, ...args], { timeout: more.timeout ?? 8000, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}), ...(more.cwd ? { cwd: more.cwd } : {}) }, (error, stdout) =>
      done(error ? '' : String(stdout ?? '')),
    )
    child.on('error', () => done(''))
  })
}

/**
 * Whether this copy has what is used, asked once per binary per build. A copy whose help cannot be
 * read at all is NOT called too old: nothing was learned, and nothing extra is passed either.
 * `--version` and `--help` start no session and call no provider.
 */
async function supports(file: string): Promise<Able> {
  let stamp = file
  try {
    stamp = `${file}@${statSync(file).mtimeMs}`
  } catch {
    /* Gone between being found and being asked. */
  }
  const known = able.get(stamp)
  if (known) return known
  const env = environment()
  const [said, help] = await Promise.all([answered(file, ['--version'], env), answered(file, ['--help'], env)])
  const version = versionOf(said)
  let out: Able
  if (!help && !version) out = { ok: true, missing: null, tells: false, lists: false, names: false, configures: false, plugins: false, backgrounds: false, tools: false, version: null }
  else {
    const missing = help ? (NEEDS.find((one) => !one.test.test(help))?.said ?? null) : null
    const configures = version !== null && atLeast(version, CONFIG_DIR_FROM)
    out = {
      ok: missing === null,
      missing,
      tells: configures,
      lists: true,
      names: false,
      configures,
      plugins: configures,
      backgrounds: false,
      tools: version !== null && atLeast(version, TOOLS_FROM),
      version: version ? version.join('.') : null,
    }
  }
  able.set(stamp, out)
  return out
}

/* ------------------------------------------------------------------------ *
 * Its records: one SQLite database, read with the system's sqlite3
 * ------------------------------------------------------------------------ */

/**
 * A session id as OpenCode spells one: `ses_` and its identifier (12 hex digits of time and 14 of
 * base62, `core/id/id.ts`). Ids this module mints for a run before OpenCode names its session use
 * the same spelling (`newId`), and never reach the database.
 */
const SESSION_ID = /^ses_[0-9A-Za-z]{10,64}$/

/** The system's sqlite3, by its full path, so that nothing a project puts on PATH is run in its place. `KEHIKOT_OPENCODE_SQLITE` replaces it for a test. */
function sqlite(env: NodeJS.ProcessEnv): string | null {
  const said = env.KEHIKOT_OPENCODE_SQLITE
  if (said !== undefined) return said && runnable(said) ? said : null
  return ['/usr/bin/sqlite3', '/opt/homebrew/bin/sqlite3', '/usr/local/bin/sqlite3'].find(runnable) ?? null
}

/** A string as an SQL literal. */
const literal = (text: string): string => `'${text.replace(/'/g, "''")}'`

/** One row of the sessions query. */
interface Row {
  id: string
  title: string | null
  directory: string | null
  updated: number | null
  cost: number | null
  first: string | null
  last: string | null
}

/**
 * Ask the database, read-only, and read its JSON answer: `[]` for no rows, null for a failure
 * (no sqlite3, no database, a schema this reads differently). Never writes: `-readonly`.
 */
function ask(sql: string, env: NodeJS.ProcessEnv = process.env): Promise<Row[] | null> {
  const bin = sqlite(env)
  if (!bin) return Promise.resolve(null)
  return new Promise((done) => {
    execFile(bin, ['-readonly', '-json', databaseFile(env), sql], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return done(null)
      const text = String(stdout ?? '').trim()
      if (!text) return done([])
      try {
        const rows = JSON.parse(text) as unknown
        done(Array.isArray(rows) ? (rows as Row[]) : null)
      } catch {
        done(null)
      }
    })
  })
}

export const LABEL_CHARS = 80
const TITLE_CHARS = 120

const line = (text: unknown, most: number): string => {
  const first = typeof text === 'string' ? (text.split('\n').map((one) => one.trim()).find(Boolean) ?? '') : ''
  return first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first
}

/** OpenCode's own title for a session nobody named yet (`isDefaultTitle` in session.ts). */
export const isDefaultTitle = (title: string): boolean => /^(New session|Child session) - \d{4}-\d{2}-\d{2}T/.test(title)

/**
 * The first and last thing a person typed in a session, as text parts of its user messages that
 * OpenCode did not add itself (`synthetic`, which is also how this module's notes are added): the
 * ONLY content of a conversation read, for a label.
 */
const PROMPT = (session: string, order: 'asc' | 'desc') =>
  `(select json_extract(p.data,'$.text') from message m join part p on p.message_id = m.id where m.session_id = ${session} and json_extract(m.data,'$.role') = 'user' and json_extract(p.data,'$.type') = 'text' and coalesce(json_extract(p.data,'$.synthetic'),0) = 0 order by m.time_created ${order}, p.id ${order} limit 1)`

/** The sessions query: a project's top-level, unarchived sessions, and any named. */
export function sessionsQuery(folders: readonly string[], also: readonly string[]): string {
  const ids = also.filter((id) => SESSION_ID.test(id))
  const where = [
    folders.length ? `(s.parent_id is null and s.time_archived is null and s.directory in (${folders.map(literal).join(',')}))` : '',
    ids.length ? `s.id in (${ids.map(literal).join(',')})` : '',
  ].filter(Boolean)
  if (!where.length) return 'select 1 where 0'
  return `select s.id as id, s.title as title, s.directory as directory, s.time_updated as updated, s.cost as cost, ${PROMPT('s.id', 'asc')} as first, ${PROMPT('s.id', 'desc')} as last from session s where ${where.join(' or ')} order by s.time_updated desc limit 500`
}

/** A folder as the program would name it: OpenCode writes the path it finds itself in (`/tmp` is `/private/tmp`). */
function spellings(path: string): Set<string> {
  const out = new Set([path])
  try {
    out.add(realpathSync(path))
  } catch {
    /* Not there. */
  }
  return out
}

/** What was last read, by the query, kept while the database and its write-ahead log are unchanged. */
const kept = new Map<string, { stamp: string; rows: Row[] }>()

async function dbStamp(env: NodeJS.ProcessEnv): Promise<string> {
  const db = databaseFile(env)
  const parts: string[] = []
  for (const file of [db, `${db}-wal`]) {
    try {
      const said = await stat(file)
      parts.push(`${said.size}@${said.mtimeMs}`)
    } catch {
      parts.push('-')
    }
  }
  return parts.join('/')
}

async function rowsOf(sql: string, env: NodeJS.ProcessEnv = process.env): Promise<Row[] | null> {
  const stamp = `${databaseFile(env)}#${await dbStamp(env)}`
  const known = kept.get(sql)
  if (known && known.stamp === stamp) return known.rows
  const rows = await ask(sql, env)
  if (rows === null) return null
  kept.set(sql, { stamp, rows })
  while (kept.size > 256) kept.delete(kept.keys().next().value!)
  return rows
}

function recordedOf(row: Row): Recorded | null {
  if (typeof row.id !== 'string' || !SESSION_ID.test(row.id)) return null
  const title = typeof row.title === 'string' ? row.title : ''
  const first = line(row.first, LABEL_CHARS)
  const label = title && !isDefaultTitle(title) ? line(title, LABEL_CHARS) : first
  return { id: row.id, label, firstPrompt: first, lastPrompt: line(row.last, TITLE_CHARS), prs: [], next: [], lastActive: typeof row.updated === 'number' ? row.updated : 0, cost: typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0 ? row.cost : 0 }
}

async function sessions(projectPath: string, also: readonly string[] = []): Promise<Recorded[]> {
  const rows = await rowsOf(sessionsQuery([...spellings(projectPath)], also))
  return (rows ?? []).flatMap((row) => recordedOf(row) ?? []).sort((a, b) => b.lastActive - a.lastActive)
}

/** The folder a recorded session ran in: what its record names. */
export async function folderOfRecord(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  const rows = await rowsOf(sessionsQuery([], [id]), env)
  const dir = rows?.[0]?.directory
  return typeof dir === 'string' && dir.startsWith('/') ? dir : null
}

/**
 * No transcript file: OpenCode keeps a conversation in its database. What the Codex module reads
 * a transcript for — the context meter, turns cut off — this module is told by the session's plugin
 * instead (meter.ts, live.ts). Null always; kept for the shape the rest of the module shares.
 */
export async function recordFile(_projectPath: string, _id: string, _env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return null
}

/** Where a conversation is now, from an id it was once under. OpenCode keeps one id per conversation, so it is that id. */
export function headOf(id: string, _held?: ReadonlyMap<string, Recorded>, _live?: ReadonlySet<string>): string {
  return id
}

/** A place's name: one line, no control characters, never starting with a dash, short. */
export function sessionName(words: readonly (string | null | undefined)[]): string {
  const said = words.map((one) => (one ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  return said.replace(/^-+\s*/, '').slice(0, 120)
}

/* ------------------------------------------------------------------------ *
 * A new session's id, which OpenCode chooses
 * ------------------------------------------------------------------------ */

/**
 * The id OpenCode gave each new session this module started, by the id this module opened it under.
 *
 * OpenCode takes no session id for a new session and creates it when the person first sends
 * something. The plugin then names it — every hook it hears carries `sessionID` — beside the run's
 * own id, which only this module and the session's environment know (`learnSession`). `/new` (or
 * `/clear`) and `/sessions` in the TUI are another session in the same process, said the same way.
 */
const LEARNED = new Map<string, string>()

export function learnSession(opened: string, session: string): void {
  if (!SESSION_ID.test(opened) || !SESSION_ID.test(session)) return
  LEARNED.delete(opened)
  LEARNED.set(opened, session)
  while (LEARNED.size > 1024) LEARNED.delete(LEARNED.keys().next().value!)
}

/** Whether OpenCode's database holds a session by this id (any folder). */
async function exists(id: string): Promise<boolean> {
  if (!SESSION_ID.test(id)) return false
  const rows = await rowsOf(sessionsQuery([], [id]))
  return Boolean(rows?.some((row) => row.id === id))
}

async function settled(_projectPath: string, id: string): Promise<string | null> {
  const real = LEARNED.get(id) ?? id
  return (await exists(real)) ? real : null
}

/* ------------------------------------------------------------------------ *
 * How it is installed
 * ------------------------------------------------------------------------ */

/**
 * How OpenCode is installed, from its own README (anomalyco/opencode, v1.19.5):
 *
 *     curl -fsSL https://opencode.ai/install | bash
 *     brew install anomalyco/tap/opencode   # macOS and Linux (recommended, always up to date)
 *     npm i -g opencode-ai@latest
 *
 * Read 2026-10-31. The installer script puts the binary in `~/.opencode/bin` and, unless told
 * `--no-modify-path`, adds that folder to the person's shell files: this module tells it not to
 * (`find` looks there anyway). Neither line asks for admin rights. That installer and the tap
 * install OpenCode 1; OpenCode 2 (`@opencode/cli`, `anomalyco/tap/opencode-v2`) is a separate line
 * this module was not checked against.
 *
 * It is DATA. Nothing in this file runs it: `live.ts` does, in a pty the person is looking at, and
 * only after a press in the page. Choosing a provider and signing in is OpenCode's own
 * (`/connect`) afterwards; this module never reads or writes its keys.
 */
const SOURCE = 'https://opencode.ai/docs'
const CHECKED = '2026-10-31'

/** Whether Homebrew is here: `brew` on PATH, or in either of Homebrew's usual prefixes. */
export function hasBrew(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) if (runnable(join(dir, 'brew'))) return true
  return toolDirs(env).some((dir) => runnable(join(dir, 'brew')))
}

/** The project's own tap, which its README recommends and which needs no admin rights. */
export const BREW_LINE = 'brew install anomalyco/tap/opencode'
/** The vendor's installer, into `~/.opencode/bin`, without touching the person's shell files. */
export const CURL_LINE = 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path'

/** The install command, the first that applies, none of which asks for admin rights. */
export function installFor(env: NodeJS.ProcessEnv = process.env): Install {
  return hasBrew(env)
    ? { line: BREW_LINE, lands: 'Homebrew’s bin folder', source: SOURCE, checked: CHECKED }
    : { line: CURL_LINE, lands: '~/.opencode/bin', source: SOURCE, checked: CHECKED }
}

/** The install command, or the stand-in a test names (`KEHIKOT_OPENCODE_INSTALL_LINE`, from the environment of whoever started this server). */
function install(env: NodeJS.ProcessEnv = process.env): Install {
  const said = env.KEHIKOT_OPENCODE_INSTALL_LINE
  const chosen = installFor(env)
  return said ? { ...chosen, line: said } : chosen
}

function installEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: installPath(env) }
}

/* eslint-disable-next-line no-control-regex */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

/** Terminal output as plain text. */
export function plain(output: string): string {
  return output.replace(ESCAPES, '').replace(/\r/g, '')
}

/** Whether an installer failed for lack of permission to write where it was asked to. */
export function deniedWrite(output: string): boolean {
  return /\bEACCES\b|permission denied/i.test(plain(output))
}

/**
 * What the person is told when the installer ended and no binary was found: plain words and the
 * next step, never a stack. The whole output stays in the terminal ("See the log").
 */
function explain(output: string, exitCode: number, ran: string, env: NodeJS.ProcessEnv = process.env): string {
  const text = plain(output)
  if (exitCode === 0) return 'The installer finished, but OpenCode was not found afterwards. See the log.'
  if (deniedWrite(text)) return `The installer can't write where it was asked to. Check that the folder is yours, or install OpenCode another way: ${SOURCE}`
  if (exitCode === 127 || /(curl|bash|brew): (command )?not found/i.test(text)) {
    return ran.startsWith('brew') ? `Homebrew was not found. Install OpenCode with its installer instead: ${CURL_LINE}` : `curl was not found. Install OpenCode another way: ${SOURCE}`
  }
  if (/could not resolve host|failed to connect/i.test(text)) return 'The installer could not reach the internet. Check the connection and try again.'
  return `The installer exited with ${exitCode}. See the log, or run ${ran || installFor(env).line} in a terminal.`
}

/**
 * The variables an OpenCode process sets for itself or a module started inside one would hand on: a
 * session opened here must not take the other one's configuration, server or client for its own.
 */
const NESTED = [
  'OPENCODE',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_CONTENT',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_CLIENT',
  'OPENCODE_PID',
  'OPENCODE_TERMINAL',
  'OPENCODE_CALLER',
  'KEHIKOT_OPENCODE_SESSION',
]

/**
 * A session's environment: the person's (`personEnv`, without the host's own `bun` this module was
 * started with first on its PATH and `BUN_BE_BUN`), without the variables of an OpenCode it was
 * started inside. A session given the host's `bun` without `BUN_BE_BUN` boots the host on every
 * `bun` or `node` it calls.
 */
function environment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = personEnv(env)
  for (const name of NESTED) delete out[name]
  return out
}

/* ------------------------------------------------------------------------ *
 * What it says it is doing: the plugin's words
 * ------------------------------------------------------------------------ */

/**
 * The words the session's plugin (`plugin/opencode/kehikot.js`) posts, and what OpenCode said that
 * made it post them — read from its bus and hooks at v1.19.5:
 *
 *     SessionStart       chat.message, the first prompt of a session in this process (or after it was compacted)
 *     UserPromptSubmit   chat.message, every prompt of a top-level session
 *     PostToolUse        tool.execute.after; permission.replied, question.replied (back to work)
 *     PermissionRequest  permission.asked (permission.updated on older copies): an approval is on screen
 *     AskUser            question.asked: OpenCode's question tool waits for an answer
 *     Stop               session.status idle (session.idle on older copies) of a top-level session
 *     Interrupt          session.error with MessageAbortedError (Esc)
 *     Compacted          session.compacted
 *     SubagentStart      session.created with a parentID (the task tool's child session)
 *     SubagentStop       session.status idle of such a child
 *     Usage              message.updated of a finished assistant message: tokens, cost, model (meter.ts)
 *
 * A permission or question in a child session is said of its top-level session, which waits on it.
 * A question asked in prose is a turn that ended, `finished` like any other. A person typing into a
 * session that was waiting for them is the answer as well (live.ts).
 */
const SIGNALS: Record<string, State> = {
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'needs-you',
  AskUser: 'needs-you',
  Stop: 'finished',
  Interrupt: 'finished',
}

/** Every word the plugin may post; anything else is dropped. */
export const WORDS: readonly string[] = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'AskUser', 'Stop', 'Interrupt', 'Compacted', 'SubagentStart', 'SubagentStop', 'Usage']

/* ------------------------------------------------------------------------ *
 * Which process was started on which conversation
 * ------------------------------------------------------------------------ */

/** The ps this machine has, by its full path. */
const PS = ['/bin/ps', '/usr/bin/ps']

/**
 * `ps -axo pid=,command=` output: each `opencode` process started on a session, as `session → pid`.
 * Only the program itself (its file is named `opencode`, or `.opencode` behind npm's launcher),
 * and only `--session <id>`, `--session=<id>` or `-s <id>`.
 */
export function readPs(text: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const raw of text.split('\n')) {
    const said = /^\s*(\d+)\s+(.*)$/.exec(raw)
    if (!said) continue
    const pid = Number(said[1])
    const words = said[2]!.split(/\s+/)
    const program = words.findIndex((word) => /(^|\/)\.?opencode$/.test(word))
    if (program < 0 || !Number.isSafeInteger(pid) || pid <= 1) continue
    const rest = words.slice(program + 1)
    for (let i = 0; i < rest.length; i += 1) {
      const word = rest[i]!
      const id = word === '--session' || word === '-s' ? rest[i + 1] : word.startsWith('--session=') ? word.slice('--session='.length) : undefined
      if (id && SESSION_ID.test(id) && !out.has(id)) out.set(id, pid)
    }
  }
  return out
}

/**
 * Every conversation an `opencode` process was started on, in any folder (`ps` reads; nothing is
 * started). One started with no id, or moved to another conversation since, is not seen: OpenCode
 * holds no lock per conversation to ask. A failure is `failed`, never an empty list.
 */
async function active(_file: string, env: NodeJS.ProcessEnv = process.env): Promise<Running> {
  const said = env.KEHIKOT_OPENCODE_PS
  const ps = said !== undefined ? (said && runnable(said) ? said : undefined) : PS.find(runnable)
  if (!ps) return { known: false, why: 'failed' }
  const text = await new Promise<string | null>((done) => {
    execFile(ps, ['-axo', 'pid=,command='], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => done(error ? null : String(stdout ?? '')))
  })
  if (text === null) return { known: false, why: 'failed' }
  const out: Active[] = []
  for (const [session, pid] of readPs(text)) {
    out.push({ session, kind: 'interactive', called: 'an OpenCode process', handle: null, pid, cwd: (await folderOfRecord(session, env)) ?? '', startedAt: null, name: '', state: null, status: null })
  }
  return { known: true, active: out }
}

/* ------------------------------------------------------------------------ *
 * The arguments
 * ------------------------------------------------------------------------ */

/**
 * A new session: no arguments of its own — OpenCode chooses the id. The settings' `--model` and
 * `--agent` are added by whoever starts it, and everything else rides on `OPENCODE_CONFIG_DIR`.
 *
 * ## Why not in the background
 *
 * `opencode` runs its TUI and its server in one process (the server in a worker); `opencode serve`
 * and `opencode attach` could split them, but a session's doors, plugin and skills are this
 * process's configuration folder, so a session started here is a child of this module's process
 * and ends with it. The next open of its place resumes it by id (`--session`).
 */
const fresh = (): string[] => []

/**
 * A recorded session. OpenCode's TUI takes `--prompt` only on its home screen (a new session), not
 * with `--session`: the one sentence this module may send a resumed conversation is sent by its
 * plugin instead (`KEHIKOT_OPENCODE_SAY`, live.ts), so `line` is not an argument here.
 */
const resume = (id: string): string[] => {
  if (!SESSION_ID.test(id)) throw new Error('that is not a session id')
  return ['--session', id]
}

/** A run's id before OpenCode names its session: spelled as a session id, never one OpenCode made. */
const newId = (): string => `ses_kehikot${randomBytes(12).toString('hex')}`

export const PROGRAM: Program = {
  name: 'OpenCode',
  binary: BINARY,
  find,
  supports,
  newId,
  isId: (id) => SESSION_ID.test(id),
  fresh,
  resume,
  settled,
  sessions,
  install,
  installEnvironment,
  explain,
  environment,
  signal: (event) => (Object.hasOwn(SIGNALS, event) ? SIGNALS[event]! : null),
  active,
}
