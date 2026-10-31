/**
 * How full a conversation's context window is, what it has cost, and what model it runs —
 * without anybody typing anything into it.
 *
 * ## Where the figures come from, and it is the whole list
 *
 * **The session's plugin** (`plugin/opencode/kehikot.js`), which hears OpenCode's bus. When an
 * answer is finished OpenCode updates its assistant message (`message.updated`, v1.19.5) with
 *
 *     tokens: { input, output, reasoning, cache: { read, write } }, cost, providerID, modelID
 *
 * and the plugin posts those numbers (`Usage`), with the model's window and the point OpenCode
 * compacts at, which it read from the model OpenCode asked (`chat.params`: `model.limit`). What is
 * in the window is `input + output + cache.read + cache.write` of the last answer — exactly what
 * OpenCode itself counts against the window (`isOverflow` in session/overflow.ts). A compaction is
 * `session.compacted` (`Compacted`).
 *
 * **The session's record** in OpenCode's database: its `cost`, summed over the whole conversation
 * by OpenCode itself, which is what is shown as its cost (program.ts reads it with the label).
 *
 * Only numbers, a model id and times are kept. Nothing anybody wrote is read for this.
 *
 * ## What cannot be known from here, and it is said rather than guessed
 *
 *  - **How the window splits** into instructions, tools and messages: OpenCode reports totals.
 *    The breakdown shows the last answer's own numbers.
 *  - **The figures before this process opened the conversation**: until its first answer here, a
 *    resumed conversation has no window figure (its cost is the record's, whole).
 *  - **The cost of a subscription plan**: OpenCode writes 0 for a model it has no price for.
 */

/** The window a session runs with: what OpenCode said, else what it said last; never a guess from the model. */
export function windowFor(said: number | null): { window: number; sure: boolean } {
  if (said !== null && Number.isFinite(said) && said > 0) return { window: said, sure: true }
  return { window: 0, sure: false }
}

/**
 * Where OpenCode compacts by itself, in tokens — what the plugin said (`usable` in OpenCode's
 * overflow.ts), else the window less 20 000, OpenCode's own buffer — and where this module starts
 * saying "compacts soon": ten points of the window before it.
 */
export function thresholds(window: number, said: number | null = null): { compactAt: number; warnAt: number; effective: number } {
  const compactAt = said !== null && said > 0 && said <= window ? said : Math.max(0, window - 20_000)
  return { compactAt, warnAt: Math.max(0, compactAt - Math.round(window * 0.1)), effective: window }
}

export const percentOf = (tokens: number, window: number): number => (window > 0 ? Math.min(100, Math.max(0, Math.round((tokens / window) * 100))) : 0)

/** One answer's own numbers. `input` is what was sent new, `cacheRead` and `cacheWrite` what the prompt cache read and wrote. */
export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface Compaction {
  at: number | null
  /** `manual` (`/compact`, pressed or typed) or `auto` (OpenCode, when the window was full). */
  trigger: string
  before: number | null
  after: number | null
}

/** What the plugin said of one answer (`Usage`), checked. */
export interface Reported {
  usage: Usage
  reasoning: number
  /** This answer's cost in dollars, as OpenCode priced it; null when it said none. */
  cost: number | null
  model: string | null
  window: number | null
  compactAt: number | null
  /** The answer was a compaction's summary. */
  summary: boolean
}

export interface Gauge {
  model: string | null
  usage: Usage | null
  /** The last answer's tokens in the window. */
  tokens: number | null
  window: number | null
  compactAt: number | null
  usageAt: number | null
  compactions: number
  last: Compaction | null
  /** A compaction was heard and no answer after it yet. */
  compactedSince: boolean
  /** When `/compact` was last typed from here: a compaction just after is the person's. */
  manualAt: number | null
  /** The sum of what was reported in this process; the record's whole cost is preferred (live.ts). */
  cost: number | null
}

export const emptyGauge = (): Gauge => ({ model: null, usage: null, tokens: null, window: null, compactAt: null, usageAt: null, compactions: 0, last: null, compactedSince: false, manualAt: null, cost: null })

const count = (value: unknown): number => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(n) && n >= 0 ? Math.floor(Math.min(n, 1e12)) : 0
}

/** The numbers a `Usage` report carries (`/api/state?event=Usage&…`), or null when it carries none. */
export function usageOf(query: { get(name: string): string | null }): Reported | null {
  const usage = { input: count(query.get('input')), cacheRead: count(query.get('cacheRead')), cacheWrite: count(query.get('cacheWrite')), output: count(query.get('output')) }
  if (usage.input + usage.cacheRead + usage.cacheWrite + usage.output === 0) return null
  const cost = Number(query.get('cost') ?? '')
  const model = query.get('model') ?? ''
  return {
    usage,
    reasoning: count(query.get('reasoning')),
    cost: query.get('cost') && Number.isFinite(cost) && cost >= 0 && cost < 1e6 ? cost : null,
    model: /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,119}$/.test(model) ? model : null,
    window: count(query.get('window')) || null,
    compactAt: count(query.get('compactAt')) || null,
    summary: query.get('summary') === '1',
  }
}

/** A gauge with one answer's report read into it. */
export function readUsage(gauge: Gauge, said: Reported, at: number): Gauge {
  const tokens = said.usage.input + said.usage.cacheRead + said.usage.cacheWrite + said.usage.output
  const last = gauge.compactedSince && gauge.last && !said.summary ? { ...gauge.last, after: tokens } : gauge.last
  return {
    ...gauge,
    model: said.model ?? gauge.model,
    usage: said.usage,
    tokens,
    window: said.window ?? gauge.window,
    compactAt: said.compactAt ?? gauge.compactAt,
    usageAt: at,
    last,
    compactedSince: gauge.compactedSince && said.summary,
    cost: said.cost === null ? gauge.cost : (gauge.cost ?? 0) + said.cost,
  }
}

/** How long after `/compact` was typed from here a compaction is the person's. */
const MANUAL_FOR = 10 * 60_000

/** A gauge after a compaction was heard. */
export function readCompacted(gauge: Gauge, at: number): Gauge {
  const manual = gauge.manualAt !== null && at - gauge.manualAt < MANUAL_FOR
  return { ...gauge, compactions: gauge.compactions + 1, last: { at, trigger: manual ? 'manual' : 'auto', before: gauge.tokens, after: null }, compactedSince: true, manualAt: manual ? null : gauge.manualAt }
}

/**
 * Every session's gauge, by session id, as its plugin reported it in this process. Bounded: the
 * oldest is forgotten first.
 */
export class Gauges {
  private readonly gauges = new Map<string, Gauge>()

  get(session: string): Gauge | null {
    return this.gauges.get(session) ?? null
  }

  private put(session: string, gauge: Gauge): void {
    this.gauges.delete(session)
    this.gauges.set(session, gauge)
    while (this.gauges.size > 512) this.gauges.delete(this.gauges.keys().next().value!)
  }

  usage(session: string, said: Reported, at: number): void {
    this.put(session, readUsage(this.get(session) ?? emptyGauge(), said, at))
  }

  compacted(session: string, at: number): void {
    this.put(session, readCompacted(this.get(session) ?? emptyGauge(), at))
  }

  manual(session: string, at: number): void {
    this.put(session, { ...(this.get(session) ?? emptyGauge()), manualAt: at })
  }
}

/** A model as a person reads it: `anthropic/claude-sonnet-5-5` is `claude-sonnet-5-5 (anthropic)`. */
export function modelName(id: string): string {
  const at = id.indexOf('/')
  if (at <= 0) return id.slice(0, 60)
  return `${id.slice(at + 1)} (${id.slice(0, at)})`.slice(0, 60)
}

/** A session's context, whole: what the page draws, the list's rows carry and the MCP tool says. */
export interface Context {
  /** The tokens in the window now, or null when nothing has been answered in this process yet. */
  tokens: number | null
  window: number
  /** Whether OpenCode itself said the window (the model's `limit.context`). */
  windowSure: boolean
  percent: number | null
  compactAt: number
  warnAt: number
  effective: number
  soon: boolean
  model: { id: string; name: string } | null
  /** What the conversation cost, as OpenCode priced it; `live` while it runs here. Null when nothing was priced. */
  cost: { usd: number; live: boolean } | null
  compacted: { times: number; last: Compaction } | null
  /** A compaction is the last thing heard: the figure is the one before it. */
  afterCompact: boolean
  split: Usage | null
  from: 'plugin'
  at: number | null
}

/** What is shown for a session, from its gauge and the cost its record holds. Null when nothing says anything yet. */
export function contextOf(gauge: Gauge | null, recordCost: number | null = null, live = true): Context | null {
  if (!gauge && recordCost === null) return null
  const g = gauge ?? emptyGauge()
  const { window, sure } = windowFor(g.window)
  if (g.tokens === null && !g.model && !g.compactions && recordCost === null) return null
  const { compactAt, warnAt, effective } = thresholds(window, g.compactAt)
  const tokens = g.tokens
  const usd = recordCost !== null && recordCost > 0 ? recordCost : g.cost
  return {
    tokens,
    window,
    windowSure: sure,
    percent: tokens === null || window === 0 ? null : percentOf(tokens, window),
    compactAt,
    warnAt,
    effective,
    soon: tokens !== null && window > 0 && tokens >= warnAt,
    model: g.model ? { id: g.model, name: modelName(g.model) } : null,
    cost: usd !== null && usd > 0 ? { usd, live } : null,
    compacted: g.compactions && g.last ? { times: g.compactions, last: g.last } : null,
    afterCompact: g.compactedSince,
    split: g.usage,
    from: 'plugin',
    at: g.usageAt,
  }
}

/** A number of tokens as a person reads it: 823, 12k, 182k, 1.0M. */
export function tokensSaid(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Dollars as a person reads them. */
export function costSaid(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/**
 * A context in words: the share (`41%`), the line beside a meter (`82k of 200k · 41%`), and the
 * warning, in words and never by colour alone (`82% — compacts soon`).
 */
export function contextWords(context: Context): { percent: string; line: string; warning: string | null; title: string } {
  const pct = context.percent === null ? '—' : `${context.percent}%`
  const about = context.afterCompact ? 'about ' : ''
  const line = context.tokens === null ? 'nothing answered here yet' : context.window ? `${about}${tokensSaid(context.tokens)} of ${tokensSaid(context.window)} · ${pct}` : `${about}${tokensSaid(context.tokens)}`
  const warning = context.soon ? (context.tokens !== null && context.tokens >= context.compactAt ? `${pct} — compacting` : `${pct} — compacts soon`) : null
  const parts = [
    context.tokens === null ? 'Context: nothing answered in this conversation since it was opened here' : `Context: ${about}${context.tokens.toLocaleString('en-US')} of ${context.window.toLocaleString('en-US')} tokens (${pct})`,
    context.window ? `compacts by itself at about ${percentOf(context.compactAt, context.window)}%` : '',
    context.model ? context.model.name : '',
    context.cost ? costSaid(context.cost.usd) : '',
    context.compacted ? `compacted ${context.compacted.times === 1 ? 'once' : `${context.compacted.times} times`}` : '',
  ]
  return { percent: pct, line, warning, title: parts.filter(Boolean).join(' · ') }
}
