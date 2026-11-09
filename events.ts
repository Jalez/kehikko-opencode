import { RESEARCH_COMPLETE_EVENT, TURN_EVENTS } from 'kehikot-module-protocol'

/**
 * The Inbox events this module declares (protocol 2.31.0, `events` in the manifest): kept apart
 * from research.ts, which reads files, because the page imports the manifest.
 *
 * They are the protocol's turn events (2.55.0, `TURN_EVENTS`), the same in every agent module:
 * "Research complete" (`done`, the host's "Answer" sound, as since 2.33.0), and the `attention` ones
 * a turn's end can be — "Needs your decision" (the agent asked a question with `tell_finished`) and
 * "Stopped without finishing" (a stall). "Action refused" is declared with them, as in every agent
 * module, but OpenCode has no refusal of its own to report (live.ts, `heard`). An older host strips
 * `sound` and plays its own default.
 */
export const RESEARCH_EVENT = RESEARCH_COMPLETE_EVENT
export const EVENTS = TURN_EVENTS.map((one) => ({ ...one }))
export const EVENT_IDS: readonly string[] = EVENTS.map((one) => one.id)
