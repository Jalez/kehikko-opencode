import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, utimesSync } from 'node:fs'
import { dirname } from 'node:path'

import { databaseFile } from '../program.ts'

/**
 * OpenCode's records, written where OpenCode keeps them — its SQLite database, the scratch one of
 * test/setup.ts — in the shape it writes (the `session`, `message` and `part` tables of
 * `core/session/sql.ts` at v1.19.5, the columns this module reads), with everything but the shape
 * taken out. The names are the Codex module's (`writeRollout`), so the tests read the same.
 */
export const T0 = Date.parse('2026-10-21T17:30:00.000Z')

let written = 0
let opened: { file: string; db: Database } | null = null

function db(): Database {
  const file = databaseFile()
  if (opened?.file === file && existsSync(file)) return opened.db
  mkdirSync(dirname(file), { recursive: true })
  const one = new Database(file)
  one.run(`create table if not exists session (id text primary key, project_id text not null, parent_id text, slug text not null, directory text not null, title text not null, version text not null, cost real not null default 0, time_created integer not null, time_updated integer not null, time_archived integer)`)
  one.run(`create table if not exists message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)`)
  one.run(`create table if not exists part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)`)
  opened = { file, db: one }
  return one
}

/** The database changed: its time moves on, so a reader that keeps what it read by the file's time reads again. */
function touched(): void {
  written += 1
  const at = new Date(T0 + written * 1000)
  try {
    utimesSync(databaseFile(), at, at)
  } catch {
    /* Not there. */
  }
}

/** A prompt the person typed, as a row `writeRollout` takes. */
export const typed = (at: number, text = 'carry on') => JSON.stringify({ kind: 'typed', at, text })
/** Rows the Codex module's tests wrote that OpenCode has no counterpart of in its database: kept so the tests read the same, and ignored. */
export const started = (at: number) => JSON.stringify({ kind: 'none', at })
export const completed = (at: number) => JSON.stringify({ kind: 'none', at })
export const counted = (at: number, _total: number) => JSON.stringify({ kind: 'none', at })

export interface Written {
  title?: string
  parent?: string
  cost?: number
  archived?: boolean
}

/** A session's record: its folder (`cwd`), then `rows` (prompts). `when` sets when it was last changed. Returns the database's path. */
export function writeRollout(id: string, cwd: string, rows: string[] = [], when?: string | number, more: Written = {}): string {
  removeRollout(id)
  const d = db()
  const updated = when === undefined ? T0 : typeof when === 'number' ? when : Date.parse(when)
  const title = more.title ?? `New session - ${new Date(T0).toISOString()}`
  d.query(`insert into session (id, project_id, parent_id, slug, directory, title, version, cost, time_created, time_updated, time_archived) values (?, 'global', ?, 'slug', ?, ?, '1.19.5', ?, ?, ?, ?)`).run(id, more.parent ?? null, cwd, title, more.cost ?? 0, T0, updated, more.archived ? updated : null)
  let n = 0
  for (const raw of rows) {
    const row = JSON.parse(raw) as { kind: string; at: number; text?: string }
    if (row.kind !== 'typed') continue
    n += 1
    const message = `msg_${id.slice(4, 16)}${String(n).padStart(6, '0')}`
    d.query(`insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)`).run(message, id, row.at, row.at, JSON.stringify({ role: 'user', time: { created: row.at } }))
    d.query(`insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)`).run(`prt_${message.slice(4)}a`, message, id, row.at, row.at, JSON.stringify({ type: 'text', text: row.text }))
    /* What Kehikot adds to a prompt (the plugin's notes): synthetic, never a label. */
    d.query(`insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)`).run(`prt_${message.slice(4)}b`, message, id, row.at, row.at, JSON.stringify({ type: 'text', text: 'Kehikot: notes', synthetic: true }))
  }
  touched()
  return databaseFile()
}

export function removeRollout(id: string): void {
  if (!existsSync(databaseFile())) return
  const d = db()
  d.query('delete from part where session_id = ?').run(id)
  d.query('delete from message where session_id = ?').run(id)
  d.query('delete from session where id = ?').run(id)
  touched()
}

/** A session's title, as OpenCode sets it once it has named the conversation. */
export function retitle(id: string, title: string): void {
  db().query('update session set title = ?, time_updated = time_updated + 1 where id = ?').run(title, id)
  touched()
}
