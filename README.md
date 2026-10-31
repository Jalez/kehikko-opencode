# OpenCode

A terminal holding the [OpenCode](https://opencode.ai) session (`opencode`, anomalyco/opencode,
formerly sst/opencode) that belongs to the place you are looking at.

Port **8130**. `kehikot.opencode`. The sibling of the Claude and Codex modules (`kehikot.claude`,
`kehikot.codex`): the same record, page, doors and promises, with `program.ts` answering for
OpenCode and one plugin (`plugin/opencode/kehikot.js`) standing where Codex's hooks stand.
Everything here was read against OpenCode **1.19.5** (its source and the docs at opencode.ai) and
tested with a stand-in CLI that loads the real plugin. **OpenCode was not installed on the machine
this was built on, and no model provider was called**: nothing here has been run against the real
binary yet (see "Not yet done").

```bash
bun install
./run.sh             # or: PORT=8130 ./run.sh
```

Then put it on a kehikko. Opened on its own (<http://127.0.0.1:8130/app>) it says nothing is
framing it: a session belongs to a project, and only a host says which.

---

## What it does

- **A session per place.** A place is project + epic + the picked parts + kehikko. Opening the
  module there shows OpenCode's own TUI in a terminal: the place's conversation, resumed by id
  (`opencode --session <id>`), or a new one. The View menu lists this kehikko's conversations;
  OpenCode's own `/sessions` and `/new` (`/clear`) work in it, and the record follows (the plugin
  names the conversation every prompt is in).
- **Disconnect and connect again**, from the View and Go menus, as in the Codex module. No agent
  may press them.
- **Filed with no command.** A conversation started here is filed under its place at its first
  prompt and is that kehikko's own when the kehikko had none. `/kehikot-here`, typed in a
  conversation this module started, assigns it to the kehikko on screen (or `kehikko: <key>`).
- **It knows where it is.** At its first prompt — and the first after a compaction — a session is
  told its place, one line per module on the kehikko (name, door, its `agentSays` or summary, its
  skills), the installed modules absent from this kehikko that say something there, and its own
  skills; at later prompts only what changed. The words are the protocol's (`sessionNotes`), word
  for word what a Claude or Codex conversation on the same kehikko is told (tested equal). The
  plugin adds them to the prompt as a synthetic text part, which the model reads and the TUI does
  not show as typed. *What this conversation was told* (View menu) shows them to the person.
- **The kehikko's MCP doors** — the host's and each module's, each carrying the conversation's
  place token — are remote MCP servers in the session's own `opencode.json`, for that one process.
- **Skills, as OpenCode commands.** `/kehikot-here`, the skills of every module on the kehikko
  (kehikko-bound ones only when what they need is there) and the skills the host keeps for every
  conversation, in the session's own `skills/` folder: each is a `/name` command and a skill the
  model can load with its `skill` tool. A person-only skill is denied to the model
  (`permission.skill`) and stays typeable. Claude Code skills are translated lightly
  (`forOpenCode`): OpenCode runs `` !`command` `` lines and fills `$ARGUMENTS` for a typed command
  as Claude Code does; `${CLAUDE_SESSION_ID}` becomes `$KEHIKOT_OPENCODE_SESSION`, which the plugin
  sets for every command OpenCode runs.
- **Working, needs you, finished**, from OpenCode's own bus as the plugin hears it, in the Inbox
  (`activity.set`) and the View menu, with a notice when a session nobody is looking at needs its
  person or finishes. "Needs you" is an approval (`permission.asked`) or a question
  (`question.asked`) in a conversation that has had a turn and that the person has not had on
  screen since — including one a subagent is waiting on. Never an empty conversation at its
  prompt; `since` stays put while the state does; an item the person opens (`onOpened`) shows its
  session.
- **Research complete** (event `research-complete`, sound "answer"): the agent says so with
  `tell_finished`, or a subagent finishes that is OpenCode's `explore` agent or whose task reads as
  research (the task tool's child session, `session.created` with a `parentID`).
- **Interrupted work.** A conversation a restart cut off mid-turn is a "needs you" line, and —
  unless "Resume conversations cut off by a restart" is off — is sent one sentence when its place
  is next opened (by the plugin, through OpenCode's own client: the TUI takes no prompt beside
  `--session`).
- **The context meter** under the session: the window in use and where OpenCode compacts, the
  model, and **the cost** (OpenCode's own sum, from its database) — more than Codex gives. With
  **Compact** (`/compact`) and **Clear** (`/clear`) typed only on a person's press, only while
  OpenCode waits at its prompt.
- **Settings**: resume cut-off conversations; the model (`--model provider/model`); the agent
  (`--agent`); "Before editing or running commands" (`permission.edit: ask`, `bash: { "*": ask }`).
  Each a person's. None can make OpenCode ask less.
- **`sessions`**, an MCP tool that reads, and **`tell_finished`**.
- The manifest says `scope: kehikko`, `holds: ['live-sessions']`, `shows: ['agent-session']`,
  `events` (research complete), `agentSays`, `agentSessions: { loadsSkills, installsSkills }`, and
  every session runs with `personEnv` (the person's `bun` and `node`, never the host's).

## What OpenCode supports, as found

Read in its source (anomalyco/opencode at `v1.19.5`), `opencode --help` as its yargs builders
write it, and opencode.ai/docs (CLI, server, config, plugins, skills, MCP servers, commands).

| | OpenCode 1.19.5 |
|---|---|
| **Install** | `curl -fsSL https://opencode.ai/install \| bash` (into `~/.opencode/bin`; adds that to shell files unless `--no-modify-path`), `brew install anomalyco/tap/opencode`, `npm i -g opencode-ai` (a Node launcher in front of `opencode-<platform>-<arch>/bin/opencode`). The installer and tap install OpenCode 1; OpenCode 2 (`@opencode/cli`, `opencode-v2` tap, v2.2.x) is a separate line, not checked. |
| **Sessions** | The TUI: `opencode [--session <id>] [--continue] [--fork] [--model p/m] [--agent a] [--prompt …]`. Ids are `ses_…`, chosen by OpenCode at the first prompt. `--prompt` is only taken on the home screen (a new session). `opencode run [msg]` is non-interactive (`--format json` for raw events, `--attach <url>`); `opencode session list --format json`. Everything is kept in one SQLite database, `~/.local/share/opencode/opencode.db` (`OPENCODE_DB`); no transcript files, no lock per session. |
| **Server / API** | `opencode serve` (HTTP, OpenAPI at `/doc`, basic auth with `OPENCODE_SERVER_PASSWORD`): sessions, `prompt_async`, `/session/status`, permission replies, `/tui/*` to drive a TUI, SSE `/event` and `/global/event`. The TUI runs the same server in a worker; with `--port` it listens. |
| **Per-run config** | `OPENCODE_CONFIG_DIR` is one more configuration folder, read after the person's global one and the project's `.opencode`: its `opencode.json` is merged over theirs, its `plugins/`, `skills/`, `commands/`, `agents/` are loaded. Also `OPENCODE_CONFIG` (a file) and `OPENCODE_CONFIG_CONTENT` (inline JSON). OpenCode `npm install`s `@opencode-ai/plugin` into any config folder it can write to, and writes a `.gitignore` there. |
| **MCP** | `mcp.<name> = { type: "remote", url, headers?, oauth?, enabled }` or `{ type: "local", command: [...] }`; tools are `<name>_<tool>`. |
| **Plugins** | JS/TS modules in `plugins/`; every export is a plugin `({ client, project, directory, worktree, serverUrl, $ }) => hooks`. Hooks: `event` (the whole bus), `chat.message` (can add parts to a prompt), `chat.params` (sees the model, its `limit`), `tool.execute.before/after`, `shell.env`, `permission.ask`, `command.execute.before`, `experimental.chat.system.transform`, `experimental.session.compacting`, and `tool` (custom tools, whose `execute` gets the `sessionID`). |
| **Skills / commands** | Skills: `SKILL.md` with `name` (`^[a-z0-9]+(-[a-z0-9]+)*$`, the folder's name) and `description`, found in `.opencode/skills`, `~/.config/opencode/skills`, `.claude/skills`, `~/.claude/skills`, `.agents/skills`, `~/.agents/skills` and every config folder; listed in the `skill` tool and each also a `/name` command. Commands: `commands/*.md` or `command` in config, with `$ARGUMENTS`, `$1…`, `` !`cmd` `` and `@file`. `permission.skill.<name>: deny` hides a skill from the model. Agents: `agents/*.md` or `agent`. |
| **State** | Bus events: `session.status` (`idle`/`busy`/`retry`), `session.idle`, `permission.asked`/`replied`, `question.asked`/`replied`/`rejected`, `session.error` (`MessageAbortedError` for Esc), `session.compacted`, `session.created` (`parentID` for a subagent), `message.updated`. |
| **Usage / cost** | Each assistant message: `tokens { input, output, reasoning, cache { read, write } }`, `cost` (USD, from the model catalog), `providerID`/`modelID`. The session row sums `cost` and tokens. `opencode stats`. It compacts at the model's window less the room for an answer (`compaction` in config). |
| **Environment** | `OPENCODE_*` variables (`OPENCODE_PERMISSION`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`, …). No variable names the session in a command; a plugin's `shell.env` can. |

## The Codex module, feature by feature

| Codex 0.6.1 | OpenCode 0.1.0 | how |
|---|---|---|
| Terminal sessions in the container, a reload reconnects to the same screen | **done** | the same server-owned runs and headless screen |
| Sessions filed per place, auto-assigned, the kehikko's own | **done** | the plugin names the conversation at its first prompt (OpenCode chooses the id) |
| Resume after restarts | **done** | `--session <id>` when the place is next opened; sessions end with this module (`holds: live-sessions`) |
| A conversation open in another process | **adapted, weaker** | OpenCode holds no lock per conversation. `ps` shows `opencode` processes started with `--session <id>`; one started without an id and moved to a conversation since is not seen |
| Per-session MCP doors | **done, better** | `mcp` in the session's own `opencode.json` (0600), not on the command line |
| Skills per session, kehikko-bound by `needs` | **done, simpler** | OpenCode has a per-run skills folder, so nothing is installed user-wide (Codex installs into `~/.agents/skills` and switches others off) |
| `/kehikot-here` | **adapted, better** | the plugin's `kehikot_here` tool (it receives the session id) posts with the run's secret; no shell, no curl, no approval. Only in conversations this module started |
| Session notes from `sessionNotes`, changes at the next prompt | **done** | `chat.message` adds them as a synthetic part; full again after `session.compacted` |
| What this conversation was told | **done** | same View item and panel |
| Working / needs you / finished, notices, Inbox rules | **done** | OpenCode's bus through the plugin. A permission asked by a subagent is "needs you" on its conversation |
| Research complete, sound "answer" | **done** | `tell_finished`, or a finished `explore` subagent / research task |
| Interrupted work after a restart | **done** | the plugin sends the sentence via `client.session.promptAsync` |
| Context meter | **done, more** | from `message.updated` and `chat.params`; **cost** from OpenCode's own sum. Before the first answer in this process a resumed conversation has no window figure |
| Compact and Clear | **done** | `/compact`, `/clear` |
| Settings | **adapted** | model, agent, ask before editing/commands; no reasoning-effort setting (OpenCode's `--variant` is only on `run`) |
| `personEnv`, ready-built, `run.sh` stamp | **done** | |
| Install helper | **done** | Homebrew tap when Homebrew is here, else the vendor installer with `--no-modify-path`; never sudo |
| Icon | **adapted** | `lucide:message-square-code`: the protocol has no OpenCode mark |
| Sessions started outside Kehikot (`sessions` lists them, Connect) | **done** | read from OpenCode's database |
| `/kehikot-here` and notes in a conversation started outside Kehikot | **not possible without global writes** | would need the plugin in `~/.config/opencode/plugins`, which this module never writes |
| Skills kept "everywhere" for conversations outside Kehikot | **not done** | given to this module's sessions only; OpenCode also reads `~/.claude/skills`, where the host keeps Claude Code's |
| Using `opencode serve` + `attach` so sessions outlive the module | **not done** | possible (the server API would also give state without a plugin), but the TUI owns its server today; kept to one process per session like Codex |

## Where its data lives

`<project>/.kehikot/opencode/places.json` (which session belongs to which place; ignored by git by
default) and `<project>/.kehikot/opencode/settings.json`. A session's folder (`OPENCODE_CONFIG_DIR`:
`opencode.json`, `plugins/kehikot.js`, `skills/`, and `kehikot/` with its token, origin and what it
was told) is in this user's temporary directory under `kehikot-opencode-<uid>/`, 0700 and made
read-only once written — so OpenCode installs nothing into it — and removed when the session ends.
OpenCode's database is read with `/usr/bin/sqlite3 -readonly`: session ids, titles, folders,
times, cost, and the first and last thing the person typed (for a label). Nothing of OpenCode's
is written; its `auth.json` is never opened.

## What it never does

- It never sends a prompt of anybody's. Its one sentence goes, once, to a conversation a restart
  cut off, behind the person's setting; and `/compact` or `/clear`, on a person's press.
- It never widens what OpenCode may do: no `--auto`, no `permission: allow`; the approval setting
  can only make it ask.
- It never writes `~/.config/opencode`, a project's `.opencode`, or OpenCode's data folder.

## Not yet done

- **A run against the real `opencode`.** OpenCode is not installed on the machine this was built
  on, and installing it or starting a session that calls a provider was out of bounds. The plugin
  is written against the 1.19.5 source and run inside a stand-in; the first real run should check:
  the plugin loads from `OPENCODE_CONFIG_DIR`; the synthetic part is accepted with the id it is
  given; `/compact` and `/clear` typed into the TUI; `client.session.promptAsync` from a plugin in
  TUI mode; the read-only folder does not trouble OpenCode.
- OpenCode 2 was not looked at.
- A `dev/e2e` drive like Codex's (real CLI, stand-in model API) is not written.

## Doors

The Codex module's, the same paths (`/app`, `/healthz`, `WS /session`, `/api/place`, `/api/rekey`,
`/api/end`, `/api/settings`, `/api/kehikot/settings`, `/api/restart`, `/api/assign`,
`/api/detach`, `/api/showing`, `/api/context`, `/api/state`, `/api/here`, `/api/feed`, `/mcp`,
`/kehikot/skills/kehikot-here.md`). `/api/state` takes the plugin's words, `thread` (the
conversation), a subagent's `agent`, `type` and `task`, and a `Usage` report's numbers.
`/api/here` believes a post that carries a running session's secret.

## Layout

| file | what is in it |
|---|---|
| `program.ts` | everything that knows it is OpenCode: where it is, what it can do, its database, its words, its processes |
| `plugin/opencode/kehikot.js` | the plugin each session is given: state, the notes, `kehikot_here`, the one sentence |
| `skills.ts`, `plugin/skills/kehikot-here` | the session's folder, the skills in it, the translation from Claude Code's |
| `meter.ts` | the context meter, from the plugin's `Usage` reports and the record's cost |
| `settings.ts` | the settings, the options and configuration they become |
| `doorConfig.ts` | the doors the host gives a session, as `mcp` entries |
| `live.ts`, `record.ts`, `context.ts`, `here.ts`, `doors.ts`, `place.ts`, `input.ts`, `cutoff.ts`, `src/` | as in the Codex module |
| `test/stand-in/opencode` | a Bun stand-in for the CLI: it keeps sessions in a SQLite database shaped like OpenCode's, loads the plugins of `OPENCODE_CONFIG_DIR` and fires their hooks |

## Checks

```bash
bun test
bun run typecheck
bun run build
```

The tests give themselves a machine of their own (`test/setup.ts`): a scratch home, OpenCode data
folder (and database), registry and PATH. They need `/usr/bin/sqlite3`.

## Served ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when `dist/` carries a stamp of
the commit checked out, and Vite otherwise. `bun run build` makes the build and the stamp; a host
runs it when it installs or updates the module, never at start.
