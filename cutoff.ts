/**
 * What a conversation's own record says about how it ended — kept from the Codex module, whose
 * transcripts it read, for the shape the record and the page share.
 *
 * ## What OpenCode has
 *
 * OpenCode keeps conversations in a database, not in a transcript file this module reads
 * (program.ts, `recordFile` is null), so nothing here is ever handed a transcript: `midTurn` and
 * `movedOn` are pure functions of a text no caller has. A turn a restart cut off is told by the
 * `working` mark this module keeps in its own record while a conversation works (`recover` in
 * live.ts), and that is the one kind said (`turn`). OpenCode writes nothing about background work
 * a process's end cut off, so `cutOffs` finds none.
 */

/** Which way something did not finish: `turn` is a turn a restart cut off. The others are kept for the record's format. */
export type CutKind = 'turn' | 'ended' | 'stopped' | 'failed'

export interface CutOff {
  /** When it was found, in milliseconds. */
  at: number
  kind: CutKind
  /** One line, for the person. */
  summary: string
  tasks: number
}

export const SUMMARY_CHARS = 90

interface Row {
  type?: unknown
  timestamp?: unknown
  payload?: { type?: unknown; item?: { type?: unknown; content?: unknown } } | null
}

const rows = function* (text: string): Generator<Row> {
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      yield JSON.parse(trimmed) as Row
    } catch {
      /* A tail that began mid-line. */
    }
  }
}

const timeOf = (row: Row): number => (typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN)

/** Background work a transcript says was cut off. OpenCode writes none (see "What OpenCode does not have"). */
export function cutOffs(_text: string): CutOff[] {
  return []
}

const said = (row: Row): string => {
  const content = row.payload?.item?.content
  return Array.isArray(content) ? content.map((part: unknown) => (typeof part === 'object' && part !== null ? String((part as { text?: unknown }).text ?? '') : '')).join('') : ''
}

/**
 * Whether the person said something in the conversation after `after`: a prompt they typed. A line
 * of this module's own (`except`) is not the person.
 */
export function movedOn(text: string, after: number, except: readonly string[] = []): boolean {
  for (const row of rows(text)) {
    if (row.type !== 'event_msg' || row.payload?.type !== 'item_completed' || row.payload.item?.type !== 'UserMessage') continue
    const words = said(row).trim()
    if (!words || except.some((line) => words === line)) continue
    const at = timeOf(row)
    if (Number.isFinite(at) && at > after) return true
  }
  return false
}

/** Whether the conversation's last turn was still under way when its record stopped growing. */
export function midTurn(text: string): boolean {
  let open = false
  for (const row of rows(text)) {
    if (row.type !== 'event_msg') continue
    const kind = row.payload?.type
    if (kind === 'task_started') open = true
    else if (kind === 'task_complete' || kind === 'turn_aborted') open = false
  }
  return open
}

/** The words for what was cut off: the label's tail, and the detail. */
export function cutOffWords(open: readonly CutOff[]): { said: string; detail: string } {
  if (open.some((one) => one.kind === 'turn')) {
    return { said: 'its turn was cut off when Kehikot restarted', detail: 'Open it to carry on: it is told what happened when you do, unless “Resume conversations cut off by a restart” is off.' }
  }
  const count = open.reduce((sum, one) => sum + one.tasks, 0)
  const tasks = `${count} background task${count === 1 ? '' : 's'}`
  return { said: `${tasks} ${count === 1 ? 'was' : 'were'} cut off or failed`, detail: open.map((one) => one.summary).join('; ') }
}
