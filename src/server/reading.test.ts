import { describe, expect, it, vi } from 'vitest'
import { BUILD_SLOTS } from '../charter/build'
import { dispatch } from '../../api/router'
import { InputError } from './propose'
import { RateLimiter } from './rate-limit'
import { claudeCodeAnswer, claudeCodeArgs, floorBreach, readHero, readerEnv, type ReaderCall } from './reading'

const ENCORE = 'ENCORE ABJ from Seedhe Maut as he appears on lunch break cover. Skill 1 "encore kha ja" skill 2 "bhussi bar de" and ultimate is a transformation "kendrick se bhi upar"'

const answer = {
  heroName: 'Encore ABJ',
  summary: 'Encore ABJ as on the Lunch Break cover: a wandering swordsman in a wide straw hat and an open blue robe, blades on his back.',
  realPerson: true,
  roleId: 'fighter',
  look: { gender: 'm', size: 'medium', physique: { weight: 0.5, muscle: 0.5, age: 0 }, colors: [{ region: 'hair', hex: '#1a1a1a' }], wearFace: false },
  wear: [{ slot: 'head', phrase: 'wide straw hat', item: 'kasa', rung: 'wear', colors: [], finishes: [], print: '', knobs: [] }],
  kit: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: 'Ronin Step', does: 'Moves fast', template: 'fighter-super-form' }])),
  form: { entry: 'burst', aura: 'flame', growth: '', trail: '', avatar: '', hair: '', hairColor: '', eyes: '', marks: '', wear: [] },
  questions: [],
}

const none = { claudeCode: null, claude: null }

describe('reading a hero (the Forge reads before it builds)', () => {
  it('takes the first reader that answers, and says which one did', async () => {
    const claudeCode = vi.fn<ReaderCall>(async () => {
      throw new Error('not signed in')
    })
    const claude = vi.fn<ReaderCall>(async () => answer)
    const result = await readHero({ prompt: ENCORE }, { claudeCode, claude })
    expect(result.reading?.source).toBe('claude')
    expect(result.reading?.kit.active1.name).toBe('Encore Kha Ja')
    expect(result.reading?.wear).toEqual([{ slot: 'head', phrase: 'wide straw hat', item: 'kasa', rung: 'wear' }])
    expect(result.reading?.form).toEqual({ entry: 'burst', aura: 'flame' })
    // the reader gets the reading's own system prompt, the request in words, and the schema
    const call = claude.mock.calls[0][0]
    expect(call.system).toMatch(/You read how a player imagines a hero/)
    expect(call.content.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('Prompt: ENCORE ABJ') })
    expect(call.schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['kit', 'questions']) })
  })

  it('reads offline when no reader is set up, when every reader fails, or past the rate limit', async () => {
    expect((await readHero({ prompt: ENCORE }, none)).reading?.source).toBe('offline')
    const failing = vi.fn<ReaderCall>(async () => {
      throw new Error('down')
    })
    expect((await readHero({ prompt: ENCORE }, { claudeCode: failing, claude: failing })).reading?.source).toBe('offline')
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 })
    limiter.take(['ip:1'])
    const claude = vi.fn<ReaderCall>(async () => answer)
    expect((await readHero({ prompt: ENCORE }, { claudeCode: null, claude, limiter, keys: ['ip:1'] })).reading?.source).toBe('offline')
    expect(claude).not.toHaveBeenCalled()
  })

  it('holds the content floor on what was asked and on what was read', async () => {
    expect((await readHero({ prompt: 'a kid wizard who throws fireballs' }, none)).refused).toMatch(/children/)
    const endorsing = { ...answer, summary: 'Encore ABJ, who endorses psyblr in every match' }
    expect((await readHero({ prompt: ENCORE }, { claudeCode: null, claude: async () => endorsing })).refused).toMatch(/endorsing/)
    expect(floorBreach('a sexy dancer', false)).toBeUndefined()
  })

  it('refuses malformed requests before any reader runs', async () => {
    await expect(readHero({}, none)).rejects.toBeInstanceOf(InputError)
    await expect(readHero({ prompt: 'x'.repeat(501) }, none)).rejects.toBeInstanceOf(InputError)
    await expect(readHero({ prompt: 'a hero', photoUrls: ['https://evil.example/a.webp'] }, none)).rejects.toBeInstanceOf(InputError)
  })

  it('a correction sends the last reading back, rebuilt like any untrusted answer', async () => {
    const first = (await readHero({ prompt: 'a samurai with a katana and a straw hat' }, none)).reading!
    const again = (await readHero({ prompt: 'a samurai with a katana and a straw hat', previous: { ...first, roleId: 'nonsense' }, note: 'no hat' }, none)).reading!
    expect(again.wear.map((w) => [w.slot, w.bare ? 'nothing' : w.item])).toEqual([
      ['head', 'nothing'],
      ['full', 'samurai_armour'],
      ['hand_r', 'katana'],
    ])
    expect(again.roleId).toBe(first.roleId)
  })
})

describe('the local reader runs your Claude Code with nothing it could act with', () => {
  it('print mode, Haiku, the schema, no tools, no MCP servers, no plugins, no session', () => {
    const args = claudeCodeArgs('system', { type: 'object' })
    const flag = (name: string) => args[args.indexOf(name) + 1]
    expect(args[0]).toBe('-p')
    expect(flag('--model')).toBe('claude-haiku-5-5')
    expect(flag('--tools')).toBe('')
    expect(flag('--setting-sources')).toBe('project')
    expect(flag('--json-schema')).toBe('{"type":"object"}')
    expect(flag('--output-format')).toBe('stream-json')
    expect(args).toContain('--verbose')
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']))
  })

  it('runs as its own CLI even when the dev server was started from inside a Claude Code session', () => {
    expect(readerEnv({ HOME: '/u', PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/x', CLAUDE_PID: '9', CLAUDE_BIN: '/opt/claude' })).toEqual({ HOME: '/u', PATH: '/bin', CLAUDE_BIN: '/opt/claude' })
  })

  it('reads the structured answer, or the result text as JSON, and fails on an error', () => {
    const stream = [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} }, { type: 'result', subtype: 'success', structured_output: { a: 1 }, result: '' }].map((e) => JSON.stringify(e)).join('\n')
    expect(claudeCodeAnswer(stream)).toEqual({ a: 1 })
    expect(claudeCodeAnswer(JSON.stringify({ type: 'result', subtype: 'success', result: '```json\n{"a":2}\n```' }))).toEqual({ a: 2 })
    expect(() => claudeCodeAnswer(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))).toThrow()
  })
})

describe('POST /api/charter/read', () => {
  it('answers with a reading, and a 422 with the reason when the floor refuses', async () => {
    const post = (body: unknown) => dispatch(new Request('https://x.test/api/charter/read', { method: 'POST', body: JSON.stringify(body) }))
    const ok = await post({ prompt: ENCORE })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { reading: { kit: { ultimate: { name: string } } } }).reading.kit.ultimate.name).toBe('Kendrick Se Bhi Upar')
    const refused = await post({ prompt: 'a kid wizard' })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ refused: true })
    expect((await post({ nope: 1 })).status).toBe(400)
  })
})
