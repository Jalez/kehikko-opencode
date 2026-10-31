/**
 * "Research complete": the Inbox event this module declares (protocol 2.31.0, `events` in the
 * manifest), and the one rule for when a subagent's finish is one.
 *
 * ## How a finished piece of research is told
 *
 *  - **The session's own agent** calls `tell_finished({ event: 'research-complete', label })` on
 *    this module's MCP door (`doors.ts`). The door knows the conversation by the place token on its
 *    URL, so only that conversation's agent (or a subagent of it, which calls the same doors) can
 *    tag its item. The tag waits for the turn to end (`Stop`), and the finished item then names the
 *    event and carries the label.
 *  - **A subagent** that finishes (`SubagentStop`, from the session's plugin) is one when it called
 *    the tool while it ran (the tag is newer than its `SubagentStart`), or when it is research
 *    (`isResearch`). It is then an item of its own. Any other subagent finishing says nothing.
 *
 * ## What OpenCode says of a subagent
 *
 * OpenCode's task tool runs a subagent in a child session (`session.created` with a `parentID`),
 * titled `<description> (@<agent> subagent)` (tool/task.ts, v1.19.5). The plugin passes the child's
 * id, the agent's name and the description; nothing else of the child is read. A subagent is
 * research when its agent is `explore` (OpenCode's built-in read-only agent for questions about the
 * code), or when the first line of its description reads as research; that line is its label.
 */

export { EVENTS, EVENT_IDS, RESEARCH_EVENT } from './events.ts'

const RESEARCH_WORDS =
  /\b(research\w*|investigat\w*|find(?:ing)? out|look(?:ing)? into|compar\w*|audit\w*|survey\w*|explor\w*|analy[sz]\w*|stud(?:y|ies|ying)|review\w*|evaluat\w*|assess\w*|read(?:ing)? up)\b/i
/** OpenCode's own read-only agent: its subagents answer questions about the code. */
const RESEARCH_ROLES = new Set(['explore'])

/** Whether a finished subagent was research: an `explore` agent, or a task whose first line has a research word. */
export function isResearch(agent: { agentType?: string | null; task?: string | null }): boolean {
  if (agent.agentType && RESEARCH_ROLES.has(agent.agentType)) return true
  return RESEARCH_WORDS.test((agent.task ?? '').trim())
}

/** A subagent's id as OpenCode gives one: its child session's id. Nothing else is used to find it. */
export const AGENT_ID = /^ses_[0-9A-Za-z]{10,64}$/
/** An agent's name as OpenCode spells one. */
export const AGENT_TYPE = /^[A-Za-z0-9:._-]{1,64}$/

/** The first line of a subagent's task, as the plugin said it: one line, no control characters, short; null for none. */
export function taskLine(said: string | null | undefined): string | null {
  const first = (said ?? '').split('\n').map((one) => one.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).find(Boolean) ?? ''
  if (!first) return null
  return first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first
}

/** What the session's agent said it finished, waiting for the turn or a subagent to end. */
export interface Told {
  event: string
  label: string
  at: number
}

/** A subagent's finished research, as an item of its own until the person opens the session. */
export interface Found {
  agent: string
  event: string
  label: string
  at: number
}

/** How many subagent items one session keeps at most; the oldest go first. */
export const FOUND_MOST = 8
