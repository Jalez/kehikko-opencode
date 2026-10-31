import { describe, expect, test } from 'bun:test'

import { Gauges, contextOf, contextWords, emptyGauge, modelName, readCompacted, readUsage, thresholds, tokensSaid, usageOf } from '../meter.ts'

/**
 * The context meter, from what a session's plugin reports of each finished answer (OpenCode's
 * `message.updated`: tokens, cost, model) and the window of the model it asked (`chat.params`).
 */

const query = (said: Record<string, string | number>) => new URLSearchParams(Object.entries(said).map(([k, v]) => [k, String(v)]))
const answer = (more: Record<string, string | number> = {}) => usageOf(query({ input: 1200, output: 80, reasoning: 5, cacheRead: 3000, cacheWrite: 0, cost: 0.01, model: 'anthropic/claude-sonnet-5-5', window: 200000, compactAt: 180000, ...more }))!

describe('what a report says', () => {
  test('the window holds input, output and both caches of the last answer — what OpenCode counts against it', () => {
    const gauge = readUsage(emptyGauge(), answer(), 1000)
    const context = contextOf(gauge)!
    expect(context).toMatchObject({ tokens: 4280, window: 200000, windowSure: true, percent: 2, compactAt: 180000, soon: false, model: { id: 'anthropic/claude-sonnet-5-5', name: 'claude-sonnet-5-5 (anthropic)' }, from: 'plugin', at: 1000 })
    expect(context.split).toEqual({ input: 1200, cacheRead: 3000, cacheWrite: 0, output: 80 })
    expect(context.cost).toEqual({ usd: 0.01, live: true })
  })

  test('nothing to read is no report; a nonsense number is nothing', () => {
    expect(usageOf(query({ input: 0, output: 0 }))).toBeNull()
    const said = usageOf(query({ input: 'lots', output: 10, cost: '-3', model: 'not a model!', window: 'x' }))!
    expect(said).toMatchObject({ usage: { input: 0, output: 10 }, cost: null, model: null, window: null })
  })

  test('costs add up in this process; the record’s whole cost, when it has one, is what is shown', () => {
    let gauge = readUsage(emptyGauge(), answer({ cost: 0.02 }), 1)
    gauge = readUsage(gauge, answer({ cost: 0.03 }), 2)
    expect(contextOf(gauge)!.cost!.usd).toBeCloseTo(0.05)
    expect(contextOf(gauge, 1.25, false)!.cost).toEqual({ usd: 1.25, live: false })
    /* A conversation resumed and not yet answered here has its record's cost and no window. */
    expect(contextOf(null, 0.5)).toMatchObject({ tokens: null, window: 0, cost: { usd: 0.5 } })
    expect(contextOf(null, null)).toBeNull()
  })

  test('a compaction is counted, the person’s when /compact was typed from here, and the figure after it is the next answer’s', () => {
    let gauge = readUsage(emptyGauge(), answer({ input: 170000 }), 1)
    gauge = { ...gauge, manualAt: 5 }
    gauge = readCompacted(gauge, 10)
    expect(contextOf(gauge)!.afterCompact).toBe(true)
    gauge = readUsage(gauge, answer({ input: 2000, summary: 1 }), 11)
    expect(gauge.compactedSince).toBe(true)
    gauge = readUsage(gauge, answer({ input: 2500 }), 12)
    const context = contextOf(gauge)!
    expect(context.compacted).toEqual({ times: 1, last: { at: 10, trigger: 'manual', before: 173080, after: 5580 } })
    expect(context.afterCompact).toBe(false)
    const auto = readCompacted(readUsage(emptyGauge(), answer(), 1), 2)
    expect(auto.last!.trigger).toBe('auto')
  })

  test('the gauges are kept by session, and bounded', () => {
    const gauges = new Gauges()
    gauges.usage('ses_aaaaaaaaaaaa', answer(), 1)
    gauges.compacted('ses_aaaaaaaaaaaa', 2)
    gauges.manual('ses_bbbbbbbbbbbb', 3)
    expect(gauges.get('ses_aaaaaaaaaaaa')!.compactions).toBe(1)
    expect(gauges.get('ses_bbbbbbbbbbbb')!.manualAt).toBe(3)
    expect(gauges.get('ses_cccccccccccc')).toBeNull()
    for (let i = 0; i < 600; i += 1) gauges.usage(`ses_x${String(i).padStart(12, '0')}`, answer(), i)
    expect(gauges.get('ses_aaaaaaaaaaaa')).toBeNull()
  })
})

describe('where it compacts, and in words', () => {
  test('where OpenCode said, else the window less its 20 000 buffer; "soon" ten points before', () => {
    expect(thresholds(200000, 180000)).toEqual({ compactAt: 180000, warnAt: 160000, effective: 200000 })
    expect(thresholds(200000)).toEqual({ compactAt: 180000, warnAt: 160000, effective: 200000 })
    expect(thresholds(100000, 999999).compactAt).toBe(80000)
  })

  test('the line, the warning in words, and the title', () => {
    const near = contextOf(readUsage(emptyGauge(), answer({ input: 166000 }), 1))!
    const words = contextWords(near)
    expect(words.line).toBe('169k of 200k · 85%')
    expect(words.warning).toBe('85% — compacts soon')
    expect(words.title).toContain('compacts by itself at about 90%')
    expect(words.title).toContain('$0.01')
    const full = contextWords(contextOf(readUsage(emptyGauge(), answer({ input: 190000 }), 1))!)
    expect(full.warning).toBe('97% — compacting')
    expect(contextWords(contextOf(null, 0.5)!).line).toBe('nothing answered here yet')
  })

  test('numbers and models as a person reads them', () => {
    expect([tokensSaid(823), tokensSaid(12_400), tokensSaid(182_000), tokensSaid(1_000_000)]).toEqual(['823', '12k', '182k', '1.0M'])
    expect(modelName('openai/gpt-5.5')).toBe('gpt-5.5 (openai)')
    expect(modelName('plain')).toBe('plain')
  })
})
