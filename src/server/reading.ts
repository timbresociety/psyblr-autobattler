import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { MAX_CHAT, MAX_PHOTOS, TEXT_LIMITS } from '../charter/build.js'
import type { Env } from '../forge/providers/types.js'
import { floorBreach, hydrateReading, offlineReading, readingRequest, readingSchema, readingSystem, readingText, type Reading, type ReadingSource, type ReadInput } from '../forge/reading.js'
import { DEV_STORE_DIR, DEV_STORE_PATH, localDev } from './dev-store.js'
import { isOwnPhotoUrl } from './photo-url.js'
import { InputError } from './propose.js'
import { RateLimiter } from './rate-limit.js'

/**
 * The Forge's readers (src/forge/reading.ts), tried in order:
 *  1. the player's own Claude Code, on the local dev server only: `claude -p` with no tools, no MCP servers and no
 *     plugins, answering in the reading's JSON schema;
 *  2. Claude Haiku 5.5 once a key is set: ANTHROPIC_API_KEY, or AI_GATEWAY_API_KEY through Vercel's AI Gateway;
 *  3. the offline parser, always.
 * Whichever answers, the reading is rebuilt from the vocabulary and the content floor checks it.
 */

export { floorBreach }

export const READING_MODEL = 'claude-haiku-5-5'
/** The same model by its AI Gateway name (checked against https://ai-gateway.vercel.sh/v1/models). */
export const GATEWAY_MODEL = 'anthropic/claude-haiku-5.5'
const GATEWAY_URL = 'https://ai-gateway.vercel.sh'
const API_TIMEOUT_MS = 30_000
const LOCAL_TIMEOUT_MS = 90_000

export type ReaderBlock = Anthropic.ImageBlockParam | Anthropic.TextBlockParam
/** An AI reader: a system prompt, the request's images and words, and the schema to answer in. Tests inject their own. */
export type ReaderCall = (request: { system: string; content: ReaderBlock[]; schema: Record<string, unknown> }) => Promise<unknown>

export interface ReadDeps {
  env?: Env
  /** The local Claude Code reader; null switches it off. */
  claudeCode?: ReaderCall | null
  /** The API reader; null switches it off. */
  claude?: ReaderCall | null
  limiter?: RateLimiter
  keys?: string[]
}

export interface ReadRequest extends ReadInput {
  /** The hero's reference images, from this app's own upload endpoint. */
  photoUrls?: string[]
}

export type ReadResult = { reading: Reading; refused?: undefined } | { refused: string; reading?: undefined }

const defaultLimiter = new RateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 })

function checkRequest(raw: unknown): ReadRequest {
  if (!raw || typeof raw !== 'object') throw new InputError('a prompt is required')
  const input = raw as Record<string, unknown>
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new InputError('a prompt is required')
  if (input.prompt.length > MAX_CHAT) throw new InputError('prompt too long')
  if (input.heroName !== undefined && (typeof input.heroName !== 'string' || input.heroName.length > TEXT_LIMITS.heroName)) throw new InputError('hero name is too long')
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > MAX_CHAT)) throw new InputError('correction too long')
  if (input.photoUrls !== undefined && !Array.isArray(input.photoUrls)) throw new InputError('photoUrls must be a list')
  const photoUrls = (input.photoUrls ?? []) as unknown[]
  if (photoUrls.length > MAX_PHOTOS) throw new InputError(`at most ${MAX_PHOTOS} photos`)
  // only photos from this app's own upload endpoint are read
  if (photoUrls.some((url) => typeof url !== 'string' || !isOwnPhotoUrl(url))) throw new InputError('photos must be uploaded through the photo endpoint')
  const request: ReadRequest = { prompt: input.prompt.trim(), photoUrls: photoUrls as string[], faceFound: input.faceFound === true }
  if (typeof input.heroName === 'string' && input.heroName.trim()) request.heroName = input.heroName.trim()
  if (typeof input.note === 'string' && input.note.trim() && input.previous) {
    request.note = input.note.trim()
    // the last reading comes back from the browser, so it is rebuilt like any other untrusted answer
    request.previous = hydrateReading(input.previous, { prompt: request.prompt, heroName: request.heroName, faceFound: request.faceFound }, 'offline')
  }
  return request
}

/** A stored dev photo, read off the disk; nothing outside the dev store can be reached. */
async function devPhoto(url: string): Promise<Buffer> {
  const root = resolve(DEV_STORE_DIR)
  const file = resolve(root, url.slice(DEV_STORE_PATH.length))
  if (!file.startsWith(root + sep)) throw new Error('outside the dev store')
  return readFile(file)
}

const MEDIA: Record<string, Anthropic.Base64ImageSource['media_type']> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }

/**
 * The request's images as content blocks. The API reads a public URL itself; the dev server's own photos, and every
 * image for the local reader, go in as their bytes.
 */
export async function imageBlocks(urls: string[], inline: boolean): Promise<ReaderBlock[]> {
  return Promise.all(
    urls.map(async (url): Promise<ReaderBlock> => {
      if (url.startsWith(DEV_STORE_PATH)) {
        const media = MEDIA[url.split('.').pop()!.toLowerCase()] ?? 'image/webp'
        return { type: 'image', source: { type: 'base64', media_type: media, data: (await devPhoto(url)).toString('base64') } }
      }
      if (!inline) return { type: 'image', source: { type: 'url', url } }
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`image ${res.status}`)
      const media = (res.headers.get('content-type') ?? 'image/webp').split(';')[0] as Anthropic.Base64ImageSource['media_type']
      return { type: 'image', source: { type: 'base64', media_type: media, data: Buffer.from(await res.arrayBuffer()).toString('base64') } }
    }),
  )
}

/** The arguments the local reader runs with: print mode, the schema, Haiku, and nothing it could act with. */
export function claudeCodeArgs(system: string, schema: Record<string, unknown>): string[] {
  return [
    '-p',
    // images go in as stream-json, which the CLI pairs with stream-json out (and that needs --verbose)
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(schema),
    '--model', READING_MODEL,
    '--effort', 'low',
    '--system-prompt', system,
    // no tools, no MCP servers, no user plugins or hooks, no skills, and no session left behind
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', 'project',
    '--disable-slash-commands',
    '--no-session-persistence',
  ]
}

/** What `claude -p --output-format stream-json` printed: its result event's structured answer, or the result text as JSON. */
export function claudeCodeAnswer(stdout: string): unknown {
  const events = stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as { type?: string; is_error?: boolean; subtype?: string; structured_output?: unknown; result?: unknown })
  const out = events.filter((e) => e.type === 'result').at(-1)
  if (!out) throw new Error('claude code gave no result')
  if (out.is_error || (out.subtype && out.subtype !== 'success')) throw new Error(`claude code: ${out.subtype ?? 'error'}`)
  if (out.structured_output && typeof out.structured_output === 'object') return out.structured_output
  if (typeof out.result === 'string') return JSON.parse(out.result.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  throw new Error('claude code gave no answer')
}

/** The environment the local reader runs in: the dev server's, without any Claude Code session it was started from. */
export function readerEnv(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|AI_AGENT$)/.test(key)))
}

/** The player's own Claude Code, run as a reader: development only, so it never runs on Vercel. */
export function claudeCodeReader(env: Env): ReaderCall {
  return async ({ system, content, schema }) => {
    const inline = await Promise.all(content.map(async (block) => (block.type === 'image' && block.source.type === 'url' ? (await imageBlocks([block.source.url], true))[0] : block)))
    return new Promise((done, fail) => {
      // a scratch directory, so no project's settings, instructions or files are in reach, and a clean environment, so a
      // dev server started from inside a Claude Code session still runs the reader as its own standalone CLI
      const child = spawn(env.CLAUDE_BIN || 'claude', claudeCodeArgs(system, schema), { cwd: tmpdir(), env: readerEnv(env), stdio: ['pipe', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const timer = setTimeout(() => child.kill('SIGTERM'), LOCAL_TIMEOUT_MS)
      child.stdout.on('data', (c: Buffer) => out.push(c))
      child.stderr.on('data', (c: Buffer) => err.push(c))
      child.on('error', (e) => (clearTimeout(timer), fail(e)))
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0) return fail(new Error(`claude exited ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`))
        try {
          done(claudeCodeAnswer(Buffer.concat(out).toString()))
        } catch (e) {
          fail(e)
        }
      })
      child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: inline } })}\n`)
    })
  }
}

/** Claude Haiku 5.5 through the API: structured output at low effort. Haiku has no server-side refusal fallback, so a refusal falls back to the offline reader. */
export function claudeReader(env: Env): ReaderCall {
  const direct = !!env.ANTHROPIC_API_KEY
  const client = new Anthropic(direct ? { apiKey: env.ANTHROPIC_API_KEY, timeout: API_TIMEOUT_MS, maxRetries: 1 } : { apiKey: env.AI_GATEWAY_API_KEY, baseURL: GATEWAY_URL, timeout: API_TIMEOUT_MS, maxRetries: 1 })
  return async ({ system, content, schema }) => {
    const response = await client.messages.create({
      model: direct ? READING_MODEL : GATEWAY_MODEL,
      // room for adaptive thinking ahead of the answer
      max_tokens: 6000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    })
    if (response.stop_reason === 'refusal') throw new Error('model declined')
    if (response.stop_reason === 'max_tokens') throw new Error('answer cut off')
    const text = response.content.find((block) => block.type === 'text')
    if (!text || text.type !== 'text') throw new Error('no structured output')
    return JSON.parse(text.text)
  }
}

/** The readers this deployment has, in the order they're tried. */
function readers(env: Env, deps: ReadDeps): [ReadingSource, ReaderCall][] {
  const out: [ReadingSource, ReaderCall][] = []
  // never under the test runner: a test reaches a reader only by injecting one
  const local = deps.claudeCode === undefined ? (localDev(env) && env.FORGE_LOCAL_AI !== '0' && !env.VITEST ? claudeCodeReader(env) : null) : deps.claudeCode
  if (local) out.push(['claude-code', local])
  const api = deps.claude === undefined ? ((env.ANTHROPIC_API_KEY || env.AI_GATEWAY_API_KEY) && !env.VITEST ? claudeReader(env) : null) : deps.claude
  if (api) out.push(['claude', api])
  return out
}

/** Read a hero from its prompt and images: the first reader that answers, rebuilt from the vocabulary, behind the floor. */
export async function readHero(raw: unknown, deps: ReadDeps = {}): Promise<ReadResult> {
  const request = checkRequest(raw)
  const asked = floorBreach(`${request.heroName ?? ''}\n${request.prompt}\n${request.note ?? ''}`, false)
  if (asked) return { refused: asked }
  const env = deps.env ?? (process.env as Env)
  const limiter = deps.limiter ?? defaultLimiter
  let reading: Reading | undefined
  const available = readers(env, deps)
  if (available.length && (!deps.keys || limiter.take(deps.keys))) {
    const content: ReaderBlock[] = [{ type: 'text', text: readingRequest(request) }]
    try {
      content.unshift(...(await imageBlocks(request.photoUrls ?? [], false)))
    } catch {
      // an image that can't be read leaves the words to read on their own
    }
    for (const [source, call] of available) {
      try {
        reading = hydrateReading(await call({ system: readingSystem(), content, schema: readingSchema() }), request, source)
        break
      } catch (error) {
        if (env.NODE_ENV !== 'test') console.warn(`reader ${source} failed:`, error instanceof Error ? error.message : error)
      }
    }
  }
  reading ??= offlineReading(request)
  const breach = floorBreach(readingText(reading), reading.realPerson)
  return breach ? { refused: breach } : { reading }
}
