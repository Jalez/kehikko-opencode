import { afterAll, describe, expect, test } from 'bun:test'
import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionDoor } from '../doorConfig.ts'
import { DEFAULTS } from '../settings.ts'
import { SKILLS_HEADING, configOf, forOpenCode, kitSkills, removeKit, sessionKit, skillText, skillsText } from '../skills.ts'

const scratch: string[] = []
const dir = () => {
  const one = mkdtempSync(join(tmpdir(), 'kehikko-opencode-skills-'))
  scratch.push(one)
  return one
}
const servers: Server[] = []
afterAll(() => {
  for (const one of servers) one.close()
  for (const one of scratch) removeKit(one)
})

const text = (name: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`

/** A stand-in module: a manifest declaring skills, and each one's text. */
function module(skills: Record<string, { text: string; version?: string; needs?: unknown[] }>, more: Record<string, unknown> = {}) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === WELL_KNOWN) {
      response.setHeader('content-type', 'application/json')
      return void response.end(JSON.stringify({ id: more.id ?? 'kehikot.x', ...more, declares: { ...((more.declares as object) ?? {}), skills: Object.entries(skills).map(([name, one]) => ({ name, summary: `${name}.`, version: one.version ?? '1', ...(one.needs ? { needs: one.needs } : {}) })) } }))
    }
    for (const [name, one] of Object.entries(skills)) if (path === skillPath(name)) return void response.end(one.text)
    response.statusCode = 404
    response.end('no')
  })
  server.listen(0, '127.0.0.1')
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/* The test document replaces `fetch` with one that applies a browser's origin rules; a module is asked from a server. */
const plain = ((url: string) =>
  new Promise((done, fail) => {
    get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode, text: async () => body }))
    }).on('error', fail)
  })) as unknown as typeof fetch

const door = (module: string, origin: string): SessionDoor => ({ module, name: module.split('.').pop()!, url: `${origin}/mcp?kehikot-place=x`, transport: 'http' })
/** The skills in a session's folder, by name. */
const installed = (kit: string) => (existsSync(join(kit, 'skills')) ? readdirSync(join(kit, 'skills')).sort() : [])
const options = (extra: { log?: string[]; everywhere?: NonNullable<Parameters<typeof sessionKit>[1]>['everywhere']; token?: string; settings?: typeof DEFAULTS; tools?: boolean } = {}) => ({
  base: dir(),
  log: (line: string) => extra.log?.push(line),
  fetch: plain,
  ...(extra.everywhere !== undefined ? { everywhere: extra.everywhere } : {}),
  ...(extra.token ? { token: extra.token, registration: '/r/kehikot.opencode.json' } : {}),
  ...(extra.settings ? { settings: extra.settings } : {}),
})
const config = (kit: string) => JSON.parse(readFileSync(join(kit, 'opencode.json'), 'utf8')) as { mcp?: Record<string, unknown>; permission?: Record<string, unknown> }

describe('a session’s own folder: OPENCODE_CONFIG_DIR', () => {
  test('every module on the kehikko and this module’s own skill, in OpenCode’s format, in the session’s own skills/ — nothing anywhere else', async () => {
    const one = module({ browse: { text: text('browse') }, 'read-page': { text: text('read-page') } })
    const two = module({ journey: { text: text('journey') } })
    const kit = await sessionKit([door('kehikot.browser', one), door('kehikot.journeys', two), door('kehikot.browser', one)], options())
    expect(installed(kit.dir)).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    expect(readFileSync(join(kit.dir, 'skills', 'browse', 'SKILL.md'), 'utf8')).toBe('---\nname: browse\ndescription: "browse skill"\n---\nDo the thing.\n')
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.implicit}`).sort()).toEqual(['browse true', 'journey true', 'kehikot-here false', 'read-page true'])
    /* This module's own is the person's to run: hidden from the model's skill tool; `/kehikot-here` still works. */
    expect(config(kit.dir).permission).toEqual({ skill: { 'kehikot-here': 'deny' } })
    /* The doors, as remote MCP servers that ask for no sign-in. */
    expect(config(kit.dir).mcp).toEqual({
      browser: { type: 'remote', url: `${one}/mcp?kehikot-place=x`, enabled: true, oauth: false },
      journeys: { type: 'remote', url: `${two}/mcp?kehikot-place=x`, enabled: true, oauth: false },
    })
    /* The plugin, the very file this module ships. */
    expect(readFileSync(join(kit.dir, 'plugins', 'kehikot.js'), 'utf8')).toBe(readFileSync(join(import.meta.dir, '..', 'plugin', 'opencode', 'kehikot.js'), 'utf8'))
    /* Read-only once written, so that OpenCode installs nothing into it; what the module keeps stays writable. */
    expect(statSync(kit.dir).mode & 0o777).toBe(0o500)
    expect(statSync(join(kit.dir, 'skills')).mode & 0o777).toBe(0o500)
    expect(statSync(join(kit.dir, 'kehikot')).mode & 0o777).toBe(0o700)
    expect(statSync(join(kit.dir, 'opencode.json')).mode & 0o777).toBe(0o600)
    expect(existsSync(join(kit.dir, '.gitignore'))).toBe(true)
    removeKit(kit.dir)
    expect(existsSync(kit.dir)).toBe(false)
  })

  test('what the plugin reads beside it: the place token, the origin, the registration — each 0600', async () => {
    const kit = await sessionKit([], options({ token: 'T'.repeat(43) }))
    expect(readFileSync(join(kit.dir, 'kehikot', 'token'), 'utf8')).toBe('T'.repeat(43))
    expect(readFileSync(join(kit.dir, 'kehikot', 'origin'), 'utf8')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(readFileSync(join(kit.dir, 'kehikot', 'registration'), 'utf8')).toBe('/r/kehikot.opencode.json')
    expect(statSync(join(kit.dir, 'kehikot', 'token')).mode & 0o777).toBe(0o600)
    /* No token: nothing to be told with. */
    const bare = await sessionKit([], options())
    expect(existsSync(join(bare.dir, 'kehikot', 'token'))).toBe(false)
  })

  test('the approvals setting becomes asking, never allowing', async () => {
    const kit = await sessionKit([], options({ settings: { ...DEFAULTS, approvals: 'ask' } }))
    expect(config(kit.dir).permission).toEqual({ edit: 'ask', bash: { '*': 'ask' }, skill: { 'kehikot-here': 'deny' } })
    expect(configOf([], [], DEFAULTS)).toEqual({ $schema: 'https://opencode.ai/config.json' })
  })

  test('a module that does not answer, or gives a text the protocol refuses, is left out with one line', async () => {
    const log: string[] = []
    const bad = module({ broken: { text: 'no front matter' } })
    const kit = await sessionKit([door('kehikot.gone', 'http://127.0.0.1:9'), door('kehikot.bad', bad)], options({ log }))
    expect(installed(kit.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('kehikot.gone did not answer'))).toBe(true)
    expect(log.some((line) => line.includes('skill broken from kehikot.bad refused'))).toBe(true)
  })

  test('a kehikko-bound skill only when what it needs is on the kehikko — by id, or by what a module there provides', async () => {
    const log: string[] = []
    const factory = module({ 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] }, 'flow-roadmap': { text: text('flow-roadmap'), needs: [{ provides: 'steps' }] } }, { id: 'kehikot.factory', name: 'Factory' })
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ log }))
    expect(installed(alone.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('review-factory') && line.includes('left out'))).toBe(true)
    const review = module({}, { id: 'kehikot.review', name: 'Review' })
    const journeys = module({}, { id: 'kehikot.journeys', name: 'Journeys', declares: { provides: ['steps'] } })
    const kit = await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review), door('kehikot.journeys', journeys)], options())
    expect(installed(kit.dir)).toEqual(['flow-roadmap', 'kehikot-here', 'review-factory'])
    /* Only this session reads them, so they need no check of their place. */
    expect(readFileSync(join(kit.dir, 'skills', 'review-factory', 'SKILL.md'), 'utf8')).toBe('---\nname: review-factory\ndescription: "review-factory skill"\n---\nDo the thing.\n')
  })

  test('the skills the host keeps for every conversation are given to the session too; one from elsewhere is not fetched', async () => {
    const log: string[] = []
    const kept = module({ 'kehikot-module': { text: text('kehikot-module') } })
    const kit = await sessionKit([], options({ log, everywhere: [{ module: 'kehikko', name: 'kehikot-module', version: '1', origin: kept }, { module: 'kehikot.x', name: 'far', version: '1', origin: 'https://example.com' }] }))
    expect(installed(kit.dir)).toEqual(['kehikot-here', 'kehikot-module'])
    expect(kitSkills(kit.dir).find((one) => one.name === 'kehikot-module')?.by).toBe('Kehikot')
    expect(log.some((line) => line.includes('not on this computer'))).toBe(true)
  })

  test('a name OpenCode would not take is left out with one line', async () => {
    const log: string[] = []
    const odd = module({ Browse_It: { text: text('Browse_It') } })
    const kit = await sessionKit([door('kehikot.odd', odd)], options({ log }))
    expect(installed(kit.dir)).toEqual(['kehikot-here'])
  })
})

describe('a skill written for Claude Code, said for OpenCode', () => {
  const claude = [
    '---',
    'name: monitor',
    'description: Ask Monitor what repeats. Only a person runs it, by typing /monitor.',
    'disable-model-invocation: true',
    'allowed-tools: Bash(curl:*), mcp__monitor__traffic',
    '---',
    '',
    'The person typed `/monitor $ARGUMENTS`. Monitor answers at http://127.0.0.1:9010:',
    '',
    '!`curl -s -m 5 -G --data-urlencode "session=${CLAUDE_SESSION_ID}" http://127.0.0.1:9010/api/traffic`',
    '',
    'Then say what repeats.',
  ].join('\n')

  test('Claude Code’s front matter goes; a person-only skill stays one; its name is still typed with /', () => {
    const said = forOpenCode(claude, 'monitor')
    expect(said.implicit).toBe(false)
    expect(said.description).toBe('Ask Monitor what repeats. Only a person runs it, by typing /monitor.')
    expect(said.text.startsWith('---\nname: monitor\ndescription: "Ask Monitor what repeats. Only a person runs it, by typing /monitor."\n---\n')).toBe(true)
    expect(said.text).not.toContain('allowed-tools')
    expect(said.text).not.toContain('disable-model-invocation')
    expect(said.text).toContain('The person typed `/monitor $ARGUMENTS`')
    expect(said.text).toContain('Only the person runs this skill, by typing `/monitor`')
  })

  test('a line Claude Code runs on load stays: OpenCode runs it too when the person types the command; the session id is the plugin’s variable', () => {
    const said = forOpenCode(claude, 'monitor')
    expect(said.text).toContain('!`curl -s -m 5 -G --data-urlencode "session=$KEHIKOT_OPENCODE_SESSION" http://127.0.0.1:9010/api/traffic`')
    expect(said.text).toContain('If you loaded this skill yourself and see such a line, run that command first')
    expect(said.text).toContain('`$ARGUMENTS` is whatever the person wrote after `/monitor`')
    expect(said.text).not.toContain('CLAUDE_SESSION_ID')
  })

  test('a skill with none of that is the same text under OpenCode’s front matter', () => {
    expect(forOpenCode(text('journey', 'Read the steps.'), 'journey')).toEqual({ name: 'journey', description: 'journey skill', implicit: true, text: '---\nname: journey\ndescription: "journey skill"\n---\nRead the steps.\n' })
  })

  test('the session is told its skills as /name commands it can call', async () => {
    const kit = await sessionKit([], options())
    const said = skillsText(kitSkills(kit.dir))!
    expect(said.startsWith(SKILLS_HEADING)).toBe(true)
    expect(said).toContain('`skill` tool')
    expect(said).toContain('- `/kehikot-here` (OpenCode): ')
    expect(said).toContain('Only when the person types it.')
    expect(skillsText([])).toBeNull()
    expect(skillText('kehikot-here')).toContain('kehikot_here')
  })
})
