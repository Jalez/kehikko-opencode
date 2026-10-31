import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'
import { SETTINGS } from './settings.ts'
import { EVENTS } from './events.ts'

export const ID = 'kehikot.opencode'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/**
 * The format a notice is sent in: the protocol's own, by its name. Whatever
 * on the canvas says it shows these is who hears — this module does not know
 * what that is, and names no module.
 */
export const NOTICES = 'kehikot.notifications@1'

/**
 * Where this module would like to answer. Said once, here, and read by `vite.config.ts` and
 * `register.ts`. Modules on this machine sit ten apart; 8130 is past every number Kehikot's
 * official list and this machine's registry give out (8100 is Codex's preference, 8110 and 8120
 * taken or spoken for), and was free when it was chosen.
 *
 * A preference and not a promise: `live.ts` checks a handshake's `Origin` and `Host` against the
 * port this server actually bound, which `vite.config.ts` reads off the listening socket.
 */
export const PREFERRED_PORT = 8130

/**
 * What this app says about itself when a host asks.
 *
 * ## What it is
 *
 * A terminal with one program in it: the OpenCode session (the `opencode` TUI) that belongs to the
 * place the person is looking at. The sibling of the Claude and Codex modules (`kehikot.claude`,
 * `kehikot.codex`), with the same promises: a session belongs to the epic, the parts picked out of
 * it and the kehikko, and moves when any of them does.
 *
 * ## What is declared
 *
 * - **`reacts: ['parts']`**, **`scope: 'kehikko'`** (2.29.0): a session is kept for a place — this
 *   kehikko, the open epic and its picked parts.
 * - **`uses: ['activity:report']`** (1.5.0): the whole list of its sessions' states, for the Inbox;
 *   **`uses: ['events:emit']`, `emits: [NOTICES]`** for a host that does not answer the list.
 * - **`agentSessions: { loadsSkills: true, installsSkills: true }`** (2.21.0, 2.23.0): it runs
 *   agent sessions and loads the kehikko-bound skills of the modules on a session's kehikko into
 *   them, and it gives its sessions skills itself, where OpenCode reads them: the session's own
 *   configuration folder (`OPENCODE_CONFIG_DIR`, skills.ts). A host routes the kehikko-bound skills
 *   here, tells it which skills it keeps for every conversation (`everywhere`), and installs none of
 *   this module's own skills (written for OpenCode) for Claude Code.
 * - **`skills`**: its own `/kehikot-here`, written for OpenCode (doors.ts adds the list, whose versions
 *   follow the origin it serves on).
 * - **`mcp.as: 'kehikko-opencode'`**: the id would derive `opencode`, the name of the program an
 *   agent is likely to be, and a door called that reads as the agent's own.
 * - **`prompt: false`**: nothing here sends a prompt to anything. The person types.
 * - **`storage: true`**: the page opens a WebSocket to its own origin.
 * - **An MCP door with one tool that reads**: which sessions belong to which place.
 * - **`settings`** (2.15.0): resuming conversations a restart cut off, the model, the agent and
 *   when OpenCode asks before acting — each a person's (settings.ts).
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'OpenCode',
  /* The icon a host draws beside the name: a key of the protocol's module icons, the mark of the
     tool this module fronts (`BRAND_MODULE_ICONS`). */
  icon: 'brand:opencode',
  version: VERSION,
  /* The format of `.kehikot/opencode/places.json`. Raise it only in the release
     that first writes data an older release cannot read. */
  dataVersion: 1,
  summary: 'A terminal holding the OpenCode session that belongs to this epic, these parts and this kehikko.',
  tags: ['agents', 'code'],
  guidance:
    'A person on this canvas has an OpenCode CLI session open in a terminal, kept for exactly the epic, the picked '
    + 'parts and the kehikko in front of them. It is theirs: they type in it, and nothing here lets you type into it, '
    + 'start one or end one. Call `sessions` with the project path to see which sessions belong to which place — '
    + 'their first prompt, when each was last active, and whether a running one is working, waiting for its person '
    + 'or finished — before starting work that one of them may already hold. Call `sessions` with `place` to be told '
    + 'in words what a place holds.',
  /* What every agent session on a kehikko with this module is told beside its name and door (protocol
     2.36.0, `sessionNotes`): one line, at most 200 characters, read as the module's words. */
  agentSays: 'The person keeps an OpenCode session for each place here. Call `sessions` before starting work one of them may already hold; you cannot type into one.',
  entry: '/app',
  /* What its content belongs to (protocol 2.29.0): one mode per scope, the default first. */
  modes: [
    { id: 'opencode', label: 'OpenCode', scope: 'kehikko', scopeSays: 'the OpenCode sessions kept for this kehikko, at the open epic and its picked parts' },
  ],
  mcp: {
    url: '/mcp',
    transport: 'http',
    as: 'kehikko-opencode',
    about:
      'Which OpenCode sessions a person keeps for which place, and whether one is working, waiting or finished;'
      + ' tell_finished says a finished turn was research. Starts and types nothing.',
  },
  extensions: { emits: [NOTICES], consumes: [] },
  reacts: ['parts'],
  /* Another module may ask for one of a place's conversations to be shown (`view.goto { show }`,
     protocol 2.28.0): Test runs, going to the session that queued a run. See `showStep`. */
  shows: ['agent-session'],
  /* "Research complete" (protocol 2.31.0): a finished turn or subagent that was research names it,
     and the host may give it a sound of its own. A case of `done`; an older host ignores it. See research.ts. */
  events: EVENTS,
  /* Its sessions run in its own process, so a restart of it ends them (protocol 2.33.0): a host does
     not restart it on its own account — an automatic update waits for them to end. */
  holds: ['live-sessions'],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['events:emit', 'activity:report'],
    agentSessions: { loadsSkills: true, installsSkills: true },
    storage: true,
    prompt: false,
    settings: SETTINGS,
  },
  health: '/healthz',
})
