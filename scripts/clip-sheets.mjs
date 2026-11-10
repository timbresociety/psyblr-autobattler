/**
 * Draws the clip audit's contact sheets through /dev/clips, in a private headless Chrome on port 9444 (never the
 * owner's 9335), and writes them to .scratch/clip-audit/sheets. Needs `npm run dev` on port 3110.
 *
 *     node scripts/clip-sheets.mjs <asks.json>     (an array of { name, ...ask }; see src/ui/dev/ClipSheet.tsx)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 9444
const OUT = process.env.SHEET_OUT ?? '.scratch/clip-audit/sheets'
const asks = JSON.parse(readFileSync(process.argv[2], 'utf8'))
mkdirSync(OUT, { recursive: true })

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(process.env.CLAUDE_JOB_DIR ?? tmpdir(), 'tmp', 'sheet-chrome')}`,
  '--headless=new', '--window-size=1600,900', '--enable-unsafe-webgpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 40 && !target; i++) {
  await wait(500)
  target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((t) => t.find((x) => x.type === 'page')).catch(() => undefined)
}
if (!target) throw new Error('no chrome')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (socket.onopen = r))
let id = 0
const pending = new Map()
socket.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) pending.get(m.id)(m)
}
const cdp = (method, params = {}) => new Promise((resolve) => {
  pending.set(++id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})
const run = async (expression) => {
  const m = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text)
  return m.result?.result?.value
}

await cdp('Page.enable')
await cdp('Page.bringToFront')
await cdp('Page.navigate', { url: `http://localhost:3110/dev/clips${process.env.SHEET_QUERY ?? ''}` })
for (let i = 0; i < 120; i++) {
  await wait(1000)
  if (await run('!!window.__sheet').catch(() => false)) break
}
await run('window.__sheet.ready')
console.log('bodies ready')
const start = Date.now()
const lows = {}
for (const [n, { name, low, ...ask }] of asks.entries()) {
  if (low) {
    lows[name] = await run(`window.__sheet.low(${JSON.stringify(ask)})`)
    continue
  }
  const url = await run(`window.__sheet.draw(${JSON.stringify(ask)})`)
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'))
  if (n % 25 === 0) console.log(`${n + 1}/${asks.length} ${((Date.now() - start) / 1000).toFixed(0)} s`)
}
if (Object.keys(lows).length) writeFileSync(join(OUT, 'low.json'), JSON.stringify(lows))
socket.close()
chrome.kill()
process.exit(0)
