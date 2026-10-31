import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one — and a machine of their own.
 *
 * Everything this module reads outside a project is pointed at a scratch
 * folder HERE, before any test file is imported, so that no test can read
 * somebody's real OpenCode sessions, find their real binary, or write a
 * registration into their real host: the home folder, OpenCode's data folder
 * (and so its database), the module registry and PATH are all the test's own.
 * A test that wants an `opencode` puts the stand-in (`test/stand-in/opencode`)
 * on its PATH. No test reaches a model provider: the stand-in has none.
 */
export const SCRATCH = mkdtempSync(join(tmpdir(), 'kehikko-opencode-test-'))
export const HOME = join(SCRATCH, 'home')
export const DATA = join(SCRATCH, 'data')
mkdirSync(HOME, { recursive: true })
mkdirSync(join(DATA, 'opencode'), { recursive: true })
process.env.HOME = HOME
process.env.XDG_DATA_HOME = DATA
delete process.env.OPENCODE_DB
delete process.env.OPENCODE_CONFIG_DIR
/* The Bun these tests run on, for the stand-in `opencode` (test/stand-in/opencode runs opencode.ts with it). */
process.env.KEHIKOT_TEST_BUN = process.execPath
process.env.KEHIKOT_MODULES_DIR = join(SCRATCH, 'modules')
process.env.PATH = '/usr/bin:/bin'
/* No host: a test that wants one stands one in. Port 9 refuses at once. */
process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:9'
/* Neither this machine's Homebrew nor its npm is looked for, or run. */
process.env.KEHIKOT_OPENCODE_TOOL_DIRS = ''
delete process.env.KEHIKOT_OPENCODE_INSTALL_LINE
delete process.env.KEHIKOT_OPENCODE_QUIET_MS
/* The system's sqlite3 reads the scratch database (program.ts); `ps` is the system's. */
if (!existsSync('/usr/bin/sqlite3')) throw new Error('these tests read a scratch OpenCode database with /usr/bin/sqlite3, which this machine does not have')

GlobalRegistrator.register()
