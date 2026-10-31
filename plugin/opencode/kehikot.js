// Kehikot's plugin for one OpenCode session.
//
// The OpenCode module copies this file into the session's own configuration folder
// (`<kit>/plugins/kehikot.js`, a 0700 folder in this user's temporary directory that the session
// is started with as OPENCODE_CONFIG_DIR) and removes it with the session. It is never installed
// anywhere OpenCode reads for other sessions.
//
// What it does, and it is the whole list:
//
//   - It says what the session is doing, one word at a time, to the module's own server on this
//     computer (POST /api/state): working, waiting for an answer on screen, finished, a subagent
//     started or finished, the tokens of the last answer. It hears OpenCode's own bus (`event`)
//     and two hooks (`chat.message`, `tool.execute.after`). The prompt, the answer, a tool's input
//     or output are never read, carried or sent; a subagent's title (the task tool's description)
//     is, for "Research complete".
//   - At each prompt of a top-level session it asks the module what the session is to be told —
//     its place and the modules on its kehikko, the protocol's `sessionNotes`, in full at the first
//     prompt and after a compaction, only what changed after that (POST /api/context) — and adds
//     the answer to the prompt as a synthetic text part, which the model reads and the TUI does
//     not show as typed.
//   - It gives the session one tool, `kehikot_here`, which assigns THIS conversation to the
//     kehikko on screen in Kehikot (POST /api/here), when the person types /kehikot-here.
//   - Once, when the module asks (KEHIKOT_OPENCODE_SAY), it sends the module's one fixed sentence to
//     a conversation a restart cut off mid-turn.
//
// The run's secret travels in the environment (KEHIKOT_TELL_SECRET), the place token in a 0600
// file beside this one (`../kehikot/token`). Neither is ever on a command line or in a URL. It
// speaks only to 127.0.0.1, gives up after a few seconds, and never fails the session: every error
// is nothing.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SESSION = /^ses_[0-9A-Za-z]{10,64}$/
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/
const SECRET = /^[0-9a-f]{16,128}$/
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

/** The module's words for a subagent the research rule calls one (research.ts): OpenCode's built-in read-only agent. */
const AGENT = /\(@([A-Za-z0-9:._-]{1,64}) subagent\)\s*$/

const read = (file) => {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

export const KehikotPlugin = async (input, options = {}) => {
  const env = options.env ?? process.env
  const kit = options.kit ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'kehikot')
  const send = options.fetch ?? fetch
  const port = /^\d{1,5}$/.test(env.KEHIKOT_TELL_PORT ?? '') ? env.KEHIKOT_TELL_PORT : null
  const secret = SECRET.test(env.KEHIKOT_TELL_SECRET ?? '') ? env.KEHIKOT_TELL_SECRET : null
  const run = SESSION.test(env.KEHIKOT_TELL_SESSION ?? '') ? env.KEHIKOT_TELL_SESSION : null
  const token = TOKEN.test(read(join(kit, 'token'))) ? read(join(kit, 'token')) : null
  const origin = LOOPBACK.test(read(join(kit, 'origin'))) ? read(join(kit, 'origin')) : port ? `http://127.0.0.1:${port}` : null
  const registration = read(join(kit, 'registration'))
  const tools = env.KEHIKOT_OPENCODE_TOOLS === '1'

  /** Top-level sessions told their full notes in this process; a compaction takes one off. */
  const started = new Set()
  /** Child sessions (the task tool's), by id: their parent and what they were asked. */
  const children = new Map()
  /** What each session was last said to be doing, so that one change is one word. */
  const last = new Map()
  /** The context window of the model each session last asked, and where it compacts, from `chat.params`. */
  const windows = new Map()
  /** The answers whose tokens were said. */
  const counted = new Set()

  /** One word to the module's own server. Two seconds at most; nothing back. */
  const tell = async (event, more = {}) => {
    if (!port || !secret || !run) return
    const query = new URLSearchParams({ event, session: run })
    for (const [key, value] of Object.entries(more)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    try {
      await send(`http://127.0.0.1:${port}/api/state?${query}`, { method: 'POST', headers: { 'x-module-ticket': secret }, signal: AbortSignal.timeout(2000) })
    } catch {
      /* The module is gone or busy: the session then has no state. */
    }
  }

  /** The module's origin now: the one it was on, else the one its registration names (it may have moved). */
  const origins = () => {
    const out = origin ? [origin] : []
    try {
      const url = JSON.parse(readFileSync(registration, 'utf8')).url
      if (typeof url === 'string' && LOOPBACK.test(url) && !out.includes(url)) out.push(url)
    } catch {
      /* No registration, or not one. */
    }
    return out
  }

  /** Ask the module what the session is to be told; the words, or null. */
  const context = async (event, session) => {
    if (!token) return null
    for (const at of origins()) {
      try {
        const response = await send(`${at}/api/context?${new URLSearchParams({ event, session })}`, { method: 'POST', headers: { 'x-module-ticket': token }, signal: AbortSignal.timeout(4000) })
        if (!response.ok) continue
        const said = await response.json().catch(() => null)
        const text = said?.hookSpecificOutput?.additionalContext
        return typeof text === 'string' && text.trim() ? text : null
      } catch {
        /* Not there: the next. */
      }
    }
    return null
  }

  /** The top-level session a session belongs to: itself, or a child's parent. */
  const topOf = (id) => {
    let at = id
    for (let i = 0; i < 8 && children.has(at); i += 1) at = children.get(at).parent
    return at
  }

  /**
   * The conversation on screen, in this process's own environment: what a skill's `` !`command` ``
   * line reads as `$KEHIKOT_OPENCODE_SESSION` when the person types it (OpenCode runs those lines
   * with this process's environment, before any hook of the prompt). One TUI, one conversation on
   * screen at a time.
   */
  const current = (id) => {
    if (SESSION.test(id ?? '') && !children.has(id) && !options.env) process.env.KEHIKOT_OPENCODE_SESSION = id
  }

  const say = async (session, word, more = {}) => {
    if (!SESSION.test(session)) return
    if (word !== 'Usage') {
      if (last.get(session) === word && word !== 'UserPromptSubmit') return
      last.set(session, word)
    }
    await tell(word, { thread: session, ...more })
  }

  /* The one sentence the module sends a conversation a restart cut off, once, when the person opens it again. */
  const line = env.KEHIKOT_OPENCODE_SAY
  const to = env.KEHIKOT_OPENCODE_SAY_TO
  if (line && SESSION.test(to ?? '') && input?.client?.session?.promptAsync) {
    setTimeout(() => {
      input.client.session.promptAsync({ path: { id: to }, body: { parts: [{ type: 'text', text: line.slice(0, 400) }] } }).catch(() => {})
    }, options.sayAfter ?? 1500)
  }

  const hooks = {
    event: async ({ event }) => {
      const p = event?.properties ?? {}
      switch (event?.type) {
        case 'session.created': {
          const info = p.info ?? {}
          if (SESSION.test(info.id ?? '') && !info.parentID) return current(info.id)
          if (!SESSION.test(info.id ?? '') || !SESSION.test(info.parentID ?? '')) return
          const title = typeof info.title === 'string' ? info.title.slice(0, 300) : ''
          const type = AGENT.exec(title)?.[1] ?? ''
          children.set(info.id, { parent: info.parentID, title, type })
          if (children.size > 256) children.delete(children.keys().next().value)
          await tell('SubagentStart', { agent: info.id, type, task: title.replace(AGENT, '').trim() })
          return
        }
        case 'session.status':
        case 'session.idle': {
          const id = p.sessionID
          const idle = event.type === 'session.idle' || p.status?.type === 'idle'
          if (!SESSION.test(id ?? '')) return
          const child = children.get(id)
          if (child) {
            if (idle && !child.done) {
              child.done = true
              await tell('SubagentStop', { agent: id, type: child.type, task: child.title.replace(AGENT, '').trim() })
            } else if (!idle) child.done = false
            return
          }
          if (idle) await say(id, 'Stop')
          else current(id)
          return
        }
        case 'permission.asked':
        case 'permission.updated':
          return say(topOf(p.sessionID ?? ''), 'PermissionRequest')
        case 'question.asked':
          return say(topOf(p.sessionID ?? ''), 'AskUser')
        case 'permission.replied':
        case 'question.replied':
        case 'question.rejected':
          return say(topOf(p.sessionID ?? ''), 'PostToolUse')
        case 'session.error':
          if (p.error?.name === 'MessageAbortedError' && SESSION.test(p.sessionID ?? '') && !children.has(p.sessionID)) return say(p.sessionID, 'Interrupt')
          return
        case 'session.compacted':
          if (!SESSION.test(p.sessionID ?? '')) return
          started.delete(p.sessionID)
          return tell('Compacted', { thread: p.sessionID })
        case 'message.updated': {
          const info = p.info ?? {}
          if (info.role !== 'assistant' || !info.time?.completed || children.has(info.sessionID) || !SESSION.test(info.sessionID ?? '')) return
          /* Once per answer: OpenCode may update a finished message again. */
          if (typeof info.id !== 'string' || counted.has(info.id)) return
          counted.add(info.id)
          if (counted.size > 1024) counted.delete(counted.values().next().value)
          const t = info.tokens ?? {}
          const limit = windows.get(info.sessionID)
          const n = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
          return say(info.sessionID, 'Usage', {
            input: n(t.input),
            output: n(t.output),
            reasoning: n(t.reasoning),
            cacheRead: n(t.cache?.read),
            cacheWrite: n(t.cache?.write),
            cost: typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost >= 0 ? info.cost : '',
            model: typeof info.providerID === 'string' && typeof info.modelID === 'string' ? `${info.providerID}/${info.modelID}`.slice(0, 120) : '',
            window: limit?.context ?? '',
            compactAt: limit?.compactAt ?? '',
            summary: info.summary ? 1 : '',
          })
        }
        default:
          return
      }
    },

    /* The model's window, and where OpenCode compacts in it (`usable` in its session/overflow.ts). */
    'chat.params': async (asked) => {
      const limit = asked?.model?.limit ?? {}
      const context = typeof limit.context === 'number' && limit.context > 0 ? Math.floor(limit.context) : 0
      if (!SESSION.test(asked?.sessionID ?? '') || !context) return
      const out = Math.min(typeof limit.output === 'number' && limit.output > 0 ? limit.output : 32000, 32000)
      const compactAt = typeof limit.input === 'number' && limit.input > 0 ? Math.max(0, limit.input - Math.min(20000, out)) : Math.max(0, context - out)
      windows.set(asked.sessionID, { context, compactAt: Math.floor(compactAt) })
    },

    'chat.message': async (asked, output) => {
      const id = asked?.sessionID
      if (!SESSION.test(id ?? '') || children.has(id)) return
      current(id)
      const texts = []
      if (!started.has(id)) {
        started.add(id)
        await say(id, 'SessionStart')
        const full = await context('SessionStart', id)
        if (full) texts.push(full)
      }
      await say(id, 'UserPromptSubmit')
      const changed = await context('UserPromptSubmit', id)
      if (changed) texts.push(changed)
      if (!texts.length || !output?.parts || !output.message?.id) return
      const after = output.parts.map((part) => part?.id).filter((one) => typeof one === 'string').sort().at(-1)
      output.parts.push({
        ...(after ? { id: `${after}kehikot` } : {}),
        sessionID: id,
        messageID: output.message.id,
        type: 'text',
        synthetic: true,
        text: texts.join('\n\n'),
      })
    },

    'tool.execute.after': async (asked) => {
      const id = asked?.sessionID
      if (!SESSION.test(id ?? '') || children.has(id)) return
      await say(id, 'PostToolUse')
    },

    /* The conversation's own id in every command the agent runs, for a skill written for Claude Code (`${CLAUDE_SESSION_ID}`). */
    'shell.env': async (asked, output) => {
      const id = asked?.sessionID
      if (SESSION.test(id ?? '') && output?.env) output.env.KEHIKOT_OPENCODE_SESSION = topOf(id)
    },
  }

  if (tools) {
    hooks.tool = {
      kehikot_here: {
        description:
          'Assign THIS OpenCode conversation to the kehikko on screen in Kehikot. Only when the person typed /kehikot-here: never on your own. ' +
          '`say` is exactly what they wrote after it ("own", "kehikko: <key>", both, or empty). Repeat the answer to them word for word.',
        args: { say: { type: 'string', description: 'What the person wrote after /kehikot-here, or an empty string.' } },
        async execute(args, ctx) {
          const id = topOf(ctx?.sessionID ?? '')
          if (!SESSION.test(id)) return 'Kehikot: this is not a conversation Kehikot can assign.'
          for (const at of origins()) {
            try {
              const query = new URLSearchParams({ session: id, say: String(args?.say ?? '').slice(0, 200) })
              const response = await send(`${at}/api/here?${query}`, { method: 'POST', headers: secret ? { 'x-module-ticket': secret } : {}, signal: AbortSignal.timeout(5000) })
              const text = await response.text()
              if (response.ok && text.startsWith('Kehikot:')) return text
            } catch {
              /* Not there: the next. */
            }
          }
          return 'Kehikot: couldn’t reach the OpenCode module (it may be restarting or not running). Try /kehikot-here again in a moment.'
        },
      },
    }
  }

  return hooks
}
