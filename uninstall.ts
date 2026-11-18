#!/usr/bin/env bun
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeOwned, runUninstall } from 'kehikot-module-protocol/serve'

import { configDirOf } from './doorConfig.ts'

/**
 * What this module wrote outside its own folder, taken away when a person uninstalls it (protocol
 * 2.108.0, `uninstall.ts`). Kehikot runs this after the module is stopped and before its folder is
 * deleted, and says the report to the person.
 *
 * Everything it gives a OpenCode session — its doors, skills, hooks and notes — lives in a folder of
 * the session's own in this user's temporary directory, and what a session was told when it had no
 * folder in one beside it; nothing runs there once the module is stopped. It writes nothing into
 * OpenCode's own configuration, so nothing there is touched; a conversation's history is the person's.
 */
await runUninstall([
  () => removeOwned(configDirOf(), 'Its session folders in the temporary directory'),
  () => removeOwned(join(tmpdir(), 'kehikot-opencode-told'), 'What its sessions were told, in the temporary directory'),
])
