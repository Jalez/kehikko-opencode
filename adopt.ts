import {
  CONVERSATION_MATCHES,
  agentTaskStartParams,
  conversationsBringParams,
  conversationsFindParams,
  type AgentTaskStartResult,
  type ConversationCandidate,
  type ConversationMatch,
  type ConversationPlace,
  type ConversationsBringResult,
  type ConversationsFindParams,
} from 'kehikot-module-protocol'
import { acceptTask, vouchHost, type Before, type VouchHostOptions } from 'kehikot-module-protocol/serve'

import { freshToken } from './doorConfig.ts'
import { ID } from './manifest.ts'
import { placeKey, readPlaceKey } from './place.ts'
import type { Program } from './program.ts'
import { assign, disconnect, homeOf, projectRoot, readPlaces, recordedIds, tokenFor, type NamedPlace, type Places } from './record.ts'

/**
 * Adopting a tracker item with the OpenCode conversation that worked on it (protocol 2.88.0): the
 * two services the HOST calls, `conversations.finder` (`find`, `bring`) and `agent.tasks` (`start`).
 * Only Kehikot's own server may call them: every route is held to `vouchHost`, and a request it does
 * not vouch for is refused with 403 before its body is read.
 *
 * ## What `find` can know, and from where
 *
 * Only what this module already reads of OpenCode's conversations: its session listing
 * (`sessionsQuery` in program.ts, read-only) — each top-level conversation's id, title, folder, when
 * it was last active, and the first and last thing its person typed (what its label is made from) —
 * and this module's own record (`places.json`). Nothing new is read. OpenCode keeps no git branch
 * and no transcript file per conversation, and this module reads no tool calls, so it cannot say a
 * conversation `created`, `pushed` or worked on the `branch` of a change. It says:
 *
 * - `mentioned` — the ref (or the change's address, or its branch) is in its title or in the first
 *   or last prompt: "mentioned !4721";
 * - `folder` — otherwise, it ran in this project's folder: "worked in this repository".
 *
 * Neither is a match a host brings by itself; both are listed for the person. Titles and reasons
 * only: no prompt text leaves here.
 *
 * ## `bring` is `/kehikot-here`'s write
 *
 * A compare-and-set over the record: taken only when the conversation is filed under `from` now
 * (compared by place key), and then exactly what `/kehikot-here` does (here.ts) — `assign` and its
 * token, or `disconnect` for `to: null` (`/kehikot-here off`). A running conversation is never
 * restarted: one this process holds the terminal of gains the place at once (`resumed`), any other
 * the next time this module opens it.
 *
 * ## `start` is how a place starts one
 *
 * `Runs.startTask` (live.ts): the same `start` a place's new conversation goes through, with the
 * brief as OpenCode's own first prompt (`--prompt` on its home screen), filed under the place by
 * `born` when OpenCode names it — the id answered.
 */

export const FIND_PATH = '/api/conversations/find'
export const BRING_PATH = '/api/conversations/bring'
export const START_PATH = '/api/tasks/start'
export const VIEW = '/app?session={session}'

/** The most candidates one answer carries (`conversationsFindResult`). */
const MOST = 20
const TITLE_CHARS = 200
const REASON_CHARS = 200
/** The largest body read: a brief is at most `AGENT_TASK_BRIEF_MAX` characters. */
const MOST_BODY = 256 * 1024

export interface AdoptNeeds {
  program: Pick<Program, 'name' | 'isId' | 'sessions' | 'find' | 'supports' | 'active'> & Partial<Pick<Program, 'newId'>>
  /** Whether this process holds the terminal of a conversation now. */
  holds(session: string): boolean
  /** A held conversation gains a place at once (`Runs.rehome`); false when none is held. */
  rehome(session: string, place: NamedPlace | null): boolean
  /** The record changed under a project: the page and the lists are told (`Runs.told`). */
  told(projectPath: string, assigned?: { key: string; session: string }): void
  /** Start a new conversation fed a brief (`Runs.startTask`), its run under `id` when given (what `start` answered). */
  start(projectPath: string, place: NamedPlace, brief: string, title: string, id?: string): Promise<{ ok: true; session: string } | { ok: false; why: string }>
  /** Where `tasks.report` goes, for a test (the host this module was started by, otherwise). */
  report?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (line: string) => void }
}

/* ------------------------------------------------------------------------ *
 * Places, as the record keeps them and as the protocol says them
 * ------------------------------------------------------------------------ */

/** The protocol's place as this module files it. Null is the project itself, no epic. */
export function namedPlace(place: ConversationPlace | null): NamedPlace {
  if (!place) return { epic: null, parts: [], kehikko: null }
  return { epic: place.epic, parts: [...place.parts], kehikko: place.kehikko ? { key: place.kehikko } : null }
}

/** The key a protocol place is filed under; null for no place. */
const keyOf = (place: ConversationPlace | null): string | null => (place ? placeKey(namedPlace(place)) : null)

/**
 * Where the record files a conversation now, as the protocol says a place. A place an older host
 * filed under a kehikko's row number is said without its kehikko (the protocol names one by key);
 * `bring` compares keys, so such a place never passes for another.
 */
export function placeNow(places: Places, session: string): { key: string | null; place: ConversationPlace | null } {
  const key = homeOf(places, session)
  const read = key ? readPlaceKey(key) : null
  if (!key || !read) return { key: null, place: null }
  return { key, place: { epic: read.epic, parts: read.parts, kehikko: read.kehikko && 'key' in read.kehikko ? read.kehikko.key : null } }
}

/* ------------------------------------------------------------------------ *
 * find
 * ------------------------------------------------------------------------ */

const WORD = /[A-Za-z0-9]/

/** Whether `needle` stands in `text` on its own: not inside a longer number, word or path. */
function standsIn(text: string, needle: string, edge: RegExp): boolean {
  if (!needle) return false
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return false
    const before = at > 0 ? text[at - 1]! : ''
    const after = text[at + needle.length] ?? ''
    if ((!before || !edge.test(before) || !WORD.test(needle[0]!)) && (!after || !edge.test(after))) return true
    from = at + 1
  }
}

/** What of the item a conversation's words name, in the words of a reason; null for nothing. */
export function mentionIn(texts: readonly string[], asked: Pick<ConversationsFindParams, 'refs' | 'url' | 'branch'>): string | null {
  const words = texts.filter(Boolean)
  if (!words.length) return null
  for (const raw of asked.refs) {
    const ref = raw.trim()
    /* A bare number names nothing on its own: `4721` is in too many sentences. */
    if (ref.length < 2 || /^\d+$/.test(ref)) continue
    if (words.some((text) => standsIn(text, ref, WORD))) return `mentioned ${ref}`
  }
  const url = asked.url?.trim().replace(/\/+$/, '')
  if (url && url.length > 8 && words.some((text) => standsIn(text, url, /[A-Za-z0-9/]/))) return `mentioned ${url}`
  const branch = asked.branch?.trim()
  if (branch && branch.length >= 3 && words.some((text) => standsIn(text, branch, /[A-Za-z0-9/_.-]/))) return `mentioned branch ${branch}`
  return null
}

const rank = (match: ConversationMatch) => CONVERSATION_MATCHES.indexOf(match)

/** `POST find`: this project's OpenCode conversations that worked on the item, strongest first. */
export async function find(asked: ConversationsFindParams, needs: AdoptNeeds): Promise<ConversationCandidate[]> {
  const root = projectRoot(asked.project)
  if (!root.ok) return []
  const project = root.value
  const read = readPlaces(project)
  const places = read.ok ? read.value : { version: 1 as const, places: {}, sessions: {} }
  const recorded = await needs.program.sessions(project, recordedIds(places))
  const running = await runningNow(needs)
  const out: ConversationCandidate[] = []
  for (const one of recorded) {
    const entry = Object.hasOwn(places.sessions, one.id) ? places.sessions[one.id] : undefined
    /* A person said it is no Kehikot conversation: never offered again. */
    if (entry?.ignored) continue
    const mention = mentionIn([one.label, one.firstPrompt ?? '', one.lastPrompt ?? ''], asked)
    out.push({
      session: one.id,
      title: (one.label || entry?.label || '').slice(0, TITLE_CHARS),
      folder: one.folder ?? project,
      lastActive: Math.max(0, Math.trunc(one.lastActive || 0)),
      match: mention ? 'mentioned' : 'folder',
      reason: (mention ?? 'worked in this repository').slice(0, REASON_CHARS),
      place: placeNow(places, one.id).place,
      running: needs.holds(one.id) || running.has(one.id),
    })
  }
  return out.sort((a, b) => rank(a.match) - rank(b.match) || b.lastActive - a.lastActive).slice(0, MOST)
}

/** The conversations an `opencode` process was started on now, as far as `ps` tells (program.ts `active`). */
async function runningNow(needs: AdoptNeeds): Promise<Set<string>> {
  const found = needs.program.find()
  if (!found.file) return new Set()
  const said = await needs.program.active(found.file).catch(() => null)
  return said?.known ? new Set(said.active.map((one) => one.session)) : new Set()
}

/* ------------------------------------------------------------------------ *
 * bring
 * ------------------------------------------------------------------------ */

/** `POST bring`: file one conversation under `to`, only if it is under `from` now. */
export async function bring(asked: { project: string; session: string; to: ConversationPlace | null; from: ConversationPlace | null }, needs: AdoptNeeds): Promise<ConversationsBringResult> {
  const result = (outcome: ConversationsBringResult['outcome'], more: Partial<ConversationsBringResult> = {}): ConversationsBringResult => ({ outcome, place: null, resumed: false, why: '', ...more })
  const root = projectRoot(asked.project)
  if (!root.ok) return result('declined', { why: root.error })
  const project = root.value
  const session = asked.session
  if (!needs.program.isId(session)) return result('no-such-session', { why: `That is not an ${needs.program.name} conversation’s id.` })
  const read = readPlaces(project)
  if (!read.ok) return result('declined', { why: read.error })
  const known = Object.hasOwn(read.value.sessions, session) || recordedIds(read.value).includes(session) || (await needs.program.sessions(project, [session])).some((one) => one.id === session)
  if (!known) return result('no-such-session', { why: `${needs.program.name} has no conversation by that id in this project.` })

  /* Read again right before the write, with nothing awaited between the compare and the set. */
  const fresh = readPlaces(project)
  if (!fresh.ok) return result('declined', { why: fresh.error })
  const now = placeNow(fresh.value, session)
  if (now.key !== keyOf(asked.from)) return result('elsewhere', { place: now.place, why: now.place ? 'It is filed under another place.' : 'It is filed under no place.' })
  if (now.key === keyOf(asked.to)) return result('brought', { place: now.place, resumed: needs.holds(session) })

  if (!asked.to) {
    /* `/kehikot-here off`: off every place, and nothing files it again on its own. */
    const written = disconnect(project, session)
    if (!written.ok) return result('declined', { why: written.error })
    const resumed = needs.rehome(session, null)
    needs.told(project)
    return result('brought', { resumed })
  }
  const place = namedPlace(asked.to)
  const written = assign(project, place, session)
  if (!written.ok) return result('declined', { why: written.error })
  /* Its token, so the doors of a session this module gives them to know its place now (as `/kehikot-here`). */
  tokenFor(project, session, freshToken)
  const resumed = needs.rehome(session, place)
  needs.told(project, { key: placeKey(place), session })
  return result('brought', { place: asked.to, resumed })
}

/* ------------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------------ */

/** `POST start`: a new conversation fed the brief, filed under the place. */
/**
 * `start`, answered at once (protocol 2.99.0): declined when the folder is no project or OpenCode is not
 * installed, else ACCEPTED under the id its run will have, and OpenCode is started after the answer — it
 * boots and is waited for until it names the conversation (up to a minute), which was far longer than
 * the host waits: the person was told OpenCode did not answer while the conversation started anyway.
 * What it came to goes to the host as `tasks.report`, which says a failure in the person's Inbox.
 */
export async function start(asked: { project: string; brief: string; place: ConversationPlace | null; title: string }, needs: AdoptNeeds): Promise<AgentTaskStartResult> {
  const root = projectRoot(asked.project)
  if (!root.ok) return { outcome: 'declined', session: null, why: root.error.slice(0, REASON_CHARS), pending: false }
  if (!needs.program.find().file) return { outcome: 'declined', session: null, why: `${needs.program.name} is not installed on this computer.`, pending: false }
  const id = needs.program.newId?.() ?? crypto.randomUUID()
  return acceptTask(
    id,
    async () => {
      const started = await needs.start(root.value, namedPlace(asked.place), asked.brief, asked.title, id)
      return started.ok ? { ok: true, conversation: started.session } : { ok: false, why: started.why.slice(0, REASON_CHARS) }
    },
    { module: ID, ...needs.report, log: needs.report?.log ?? ((line) => console.log(`opencode: ${line}`)) },
  )
}

/* ------------------------------------------------------------------------ *
 * The door
 * ------------------------------------------------------------------------ */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * The three routes as a door of this module's own, asked before the protocol's doors (`Before`):
 * the protocol's `answer` is not handed a request's headers, and `vouchHost` reads two of them.
 * Mounted on both servers (`beforeDoors` in vite.config.ts, `run({ before })` in serve.ts).
 */
export function hostDoor(needs: () => AdoptNeeds, vouch: VouchHostOptions = {}): Before {
  return async (request, { url }) => {
    const path = url.pathname
    if (path !== FIND_PATH && path !== BRING_PATH && path !== START_PATH) return undefined
    if (request.method !== 'POST') return json({ ok: false, error: 'this door takes POST' }, 405)
    const vouched = await vouchHost(request.headers, vouch)
    if (!vouched.ok) return json({ ok: false, error: vouched.why }, 403)
    let body: unknown
    try {
      const text = await request.text()
      if (text.length > MOST_BODY) return json({ ok: false, error: 'the body is too large' }, 413)
      body = JSON.parse(text)
    } catch {
      return json({ ok: false, error: 'the body must be JSON' }, 400)
    }
    if (path === FIND_PATH) {
      const parsed = conversationsFindParams.safeParse(body)
      if (!parsed.success) return json({ ok: false, error: 'that is not what find takes' }, 400)
      return json({ conversations: await find(parsed.data, needs()) })
    }
    if (path === BRING_PATH) {
      const parsed = conversationsBringParams.safeParse(body)
      if (!parsed.success) return json({ ok: false, error: 'that is not what bring takes' }, 400)
      return json(await bring(parsed.data, needs()))
    }
    const parsed = agentTaskStartParams.safeParse(body)
    if (!parsed.success) return json({ ok: false, error: 'that is not what start takes' }, 400)
    return json(await start(parsed.data, needs()))
  }
}
