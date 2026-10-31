# OpenCode — notes for agents

A Kehikot module: a terminal holding the OpenCode session (`opencode`) that belongs to a place
(project, epic, picked parts, kehikko). The sibling of the Codex module (`kehikot.codex`): the same
record, page and doors, with `program.ts` answering for OpenCode and `plugin/opencode/kehikot.js`
standing where Codex's hooks stand. README.md says what it does and why, and what OpenCode can and
cannot do here.

## The rules

- **Nothing of OpenCode's is written.** Not `~/.config/opencode`, not a project's `.opencode`, not
  its data folder. Everything a session is given is in its own folder, `OPENCODE_CONFIG_DIR`
  (`sessionKit` in skills.ts): `opencode.json` (doors, denied skills, the settings' permissions),
  `plugins/kehikot.js`, `skills/`, `kehikot/` (token, origin, told). 0700, made read-only once
  written so OpenCode installs nothing into it, removed with the session (`removeKit`).
- **Never a flag or a setting that lets OpenCode ask less**: no `--auto`, no `permission: allow`.
- **The plugin is plain JavaScript with no imports but `node:`**, and every export of it is a
  plugin (OpenCode calls each). It reads nothing a person wrote beyond what it must pass on (a
  subagent's task title), and speaks only to 127.0.0.1. A new word it posts goes in `WORDS`
  (program.ts); `test/program.test.ts` checks the two agree.
- **OpenCode's database is read only**, with `/usr/bin/sqlite3 -readonly` (`sessionsQuery` in
  program.ts). Never `auth.json`.
- **Project data** lives only in `<project>/.kehikot/opencode/` (`record.ts`, the protocol's
  `moduleDir`/`moduleFile`).
- **Tests never reach the real machine**: `test/setup.ts` points HOME, `XDG_DATA_HOME` (OpenCode's
  database), the registry and PATH at scratch. `test/stand-in/opencode` (a Bun script) imitates the
  CLI as read in the 1.19.5 source and loads the real plugin. No test calls a model provider.
- **Never a browser on this Mac**; DOM tests use happy-dom.

## Releasing

Kehikot installs and updates this module from its GitHub releases, not from `main`.
Nobody tags by hand: merging the version bump is the release.

1. Bump `version` in `package.json` (semver). It is the only place the version is written.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. On that push to `main`, `.github/workflows/release.yml` (the shared
   `module-release.yml` in Jalez/kehikko-desktop) sees that `package.json`'s
   version is newer than the latest `v*` tag and that the notes exist, creates
   the annotated tag `v<version>` on the merge commit, checks the notes,
   typechecks and tests, then publishes the release "OpenCode <version>" in the
   same run. A push that keeps the version releases nothing; a newer version
   without notes fails the run. If a check fails nothing is published: fix it
   in a PR with a newer version.

## Ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when `dist/.kehikot-built` names
the commit checked out, and Vite otherwise. `bun run build` makes it; a host runs that at install
and update, never at start. Under Bun the pty is Bun's own (`pty.ts`).
