import { ACT_ON_MESSAGES_SETTING, KEHIKOT_DIR, WAKE_ON_MESSAGES_SETTING, settingValueIssue, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

/**
 * OpenCode's settings as a host shows them (protocol 2.15.0, `declares.settings`), kept in the
 * project's `.kehikot/opencode/settings.json` — the same file the page's toggle writes, in the same
 * format. Pure; the door is in `doors.ts`, the arguments a setting becomes are `sessionFlags`, the
 * configuration `permissionOf`.
 *
 * Each is the person's (`personOnly`): an agent is refused. Resuming a conversation a restart cut
 * off sends a sentence on the person's account; the model and the agent change what a session does
 * and costs; how often OpenCode asks before it acts is theirs to say.
 *
 * What is NOT a setting here, on purpose: anything that lets OpenCode act without asking where the
 * person's own configuration asks (`--auto`, `permission: "allow"`). The approval choice can only
 * make OpenCode ask more.
 */

export const SETTINGS_FILE = `${KEHIKOT_DIR}/opencode/settings.json`

export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([
  {
    key: 'resumeCutOff',
    label: 'Resume conversations cut off by a restart',
    description: 'A conversation a restart stopped mid-turn is told what happened when you open it again, and carries on. Off: it waits for you.',
    type: 'boolean',
    default: true,
    personOnly: true,
  },
  {
    key: 'model',
    label: 'Model for new sessions',
    description: 'The model a session started or resumed here asks for, as OpenCode names it: provider/model (for example anthropic/claude-sonnet-5-5). Empty: what your OpenCode config says.',
    type: 'string',
    default: '',
    personOnly: true,
  },
  {
    key: 'agent',
    label: 'Agent',
    description: 'The OpenCode agent a session starts with (build, plan, or one of yours). Empty: OpenCode’s default.',
    type: 'string',
    default: '',
    personOnly: true,
  },
  {
    key: 'approvals',
    label: 'When OpenCode asks before acting',
    description: 'Your OpenCode config: as it says. Before editing or running commands: OpenCode asks before it edits a file or runs a command, for sessions started here. Neither lets it do anything your config would ask about.',
    type: 'choice',
    choices: [
      { value: 'default', label: 'OpenCode config' },
      { value: 'ask', label: 'Before editing or running commands' },
    ],
    default: 'default',
    personOnly: true,
  },
  /* (protocol 2.43.0) The protocol's own two, the same in every agent module: a message wakes an idle session, and may be acted on. */
  WAKE_ON_MESSAGES_SETTING,
  ACT_ON_MESSAGES_SETTING,
])

/** A project's settings for this module. */
export interface Settings {
  resumeCutOff: boolean
  model: string
  agent: string
  approvals: string
  /** Type one line into an idle session's prompt when a message comes for it (protocol 2.43.0). */
  wakeOnMessages: boolean
  /** Sessions here may act on requests from other agent sessions in the project (protocol 2.43.0). */
  actOnMessages: boolean
}

export const DEFAULTS: Settings = { resumeCutOff: true, model: '', agent: '', approvals: 'default', wakeOnMessages: true, actOnMessages: true }

/** A model as OpenCode takes one: `provider/model`, no spaces, no quotes. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}\/[A-Za-z0-9][A-Za-z0-9._:@/-]{0,79}$/
/** An agent's name: one word. */
const AGENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Why `value` cannot be setting `key`, or null. Beyond the protocol's type check: a model is provider/model, an agent one word. */
export function settingIssue(key: string, value: unknown): string | null {
  const field = SETTINGS.find((one) => one.key === key)
  if (!field) return `OpenCode has no setting called "${key.slice(0, 64)}".`
  const wrong = settingValueIssue(field, value)
  if (wrong) return `${field.label}: ${wrong}.`
  if (key === 'model' && value !== '' && !MODEL.test(String(value))) return 'A model is provider/model, as OpenCode names it (for example anthropic/claude-sonnet-5-5).'
  if (key === 'agent' && value !== '' && !AGENT.test(String(value))) return 'An agent is one word, as OpenCode names it (for example build or plan).'
  return null
}

/** Settings off a file, each value the default where the file says nothing it could be. */
export function settingsOf(raw: unknown): Settings {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (Object.hasOwn(said, key) && settingIssue(key, said[key]) === null) (out as Record<string, unknown>)[key] = said[key]
  }
  return out
}

/**
 * The arguments a project's settings give a session started or resumed here: `--model` and
 * `--agent`, OpenCode's own options. Nothing for a setting left at its default — the person's own
 * OpenCode config then decides, as in any terminal.
 */
export function sessionFlags(settings: Settings): string[] {
  const out: string[] = []
  if (settings.model && MODEL.test(settings.model)) out.push('--model', settings.model)
  if (settings.agent && AGENT.test(settings.agent)) out.push('--agent', settings.agent)
  return out
}

/**
 * What of the settings is configuration, for the session's own `opencode.json` (skills.ts): with
 * "Before editing or running commands", `permission.edit` is `ask` and `permission.bash` asks for
 * every command (`{ "*": "ask" }`). Nothing otherwise. OpenCode merges objects key by key, so a
 * command pattern of the person's own (`"git status": "allow"`, `"rm *": "deny"`) is kept beside it.
 * Where the person's config says one word for all of `bash` or `edit` (`"deny"`), this replaces it
 * with asking: the person is asked, never skipped.
 */
export function permissionOf(settings: Settings): Record<string, string | Record<string, string>> {
  return settings.approvals === 'ask' ? { edit: 'ask', bash: { '*': 'ask' } } : {}
}
