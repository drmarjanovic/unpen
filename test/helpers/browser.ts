import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, relative, resolve, sep } from 'node:path'

import { chromium, type Browser } from 'playwright'

import type { Box } from './fidelity.ts'

export type PageCheck = {
  failedRequests: string[]
  undefinedVariables: string[]
  unloadedFonts: string[]
  boxes: Map<string, Box>
}

export type BoxMismatch = { id: string; expected: Box; actual: Box }

export function launchBrowser(): Promise<Browser> {
  return chromium.launch()
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
}

export type StaticServer = { url(file: string): string; close(): Promise<void> }

/** Serves `root` over HTTP, since browsers hide the rules of stylesheets loaded from file URLs. */
export async function serve(root: string): Promise<StaticServer> {
  const base = resolve(root)
  const server: Server = createServer(async (request, response) => {
    const path = resolve(join(base, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)))
    if (path !== base && !path.startsWith(base + sep)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(path)
      response.writeHead(200, { 'content-type': MIME_TYPES[extname(path)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: (file) =>
      `http://127.0.0.1:${port}/${relative(base, file).split(sep).map(encodeURIComponent).join('/')}`,
    close: () => new Promise((done) => server.close(() => done()))
  }
}

/** Opens an exported page and records what failed to load and where each layer landed. */
export async function checkPage(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number }
): Promise<PageCheck> {
  const page = await browser.newPage({
    viewport: { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) }
  })
  const failedRequests: string[] = []
  page.on('requestfailed', (request) => failedRequests.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(response.url())
  })
  try {
    await page.goto(url, { waitUntil: 'load' })
    const result = await page.evaluate(async () => {
      await document.fonts.ready
      const cssText = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
        .join('\n')
      const used = new Set([...cssText.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
      const defined = new Set([...cssText.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]))
      const undefinedVariables = [...used].filter(
        (name): name is string => !!name && !defined.has(name)
      )

      const generic = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy'])
      const families = new Set<string>()
      for (const element of document.querySelectorAll('[data-open-pencil-node-id]')) {
        if (!element.textContent?.trim()) continue
        const family = getComputedStyle(element).fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
        if (family && !generic.has(family)) families.add(family)
      }
      const loaded = new Set(
        [...document.fonts]
          .filter((face) => face.status === 'loaded')
          .map((face) => face.family.replace(/^["']|["']$/g, ''))
      )
      const unloadedFonts = [...families].filter((family) => !loaded.has(family))

      const root = document.querySelector('.op-stage > [data-open-pencil-node-id]')
      const origin = root?.getBoundingClientRect() ?? { x: 0, y: 0 }
      const boxes: [string, { x: number; y: number; width: number; height: number }][] = []
      for (const element of document.querySelectorAll('[data-open-pencil-node-id]')) {
        const id = element.getAttribute('data-open-pencil-node-id')
        const rect = element.getBoundingClientRect()
        if (id) boxes.push([id, { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }])
      }
      return { undefinedVariables, unloadedFonts, boxes }
    })
    return { failedRequests, ...result, boxes: new Map(result.boxes) }
  } finally {
    await page.close()
  }
}

/** Layers whose box in the page differs from their box in the design by more than `tolerance`. */
export function compareBoxes(
  expected: Map<string, Box>,
  actual: Map<string, Box>,
  tolerance = 2
): BoxMismatch[] {
  const mismatches: BoxMismatch[] = []
  for (const [id, box] of expected) {
    const rendered = actual.get(id)
    if (!rendered) continue
    const off = (['x', 'y', 'width', 'height'] as const).some(
      (key) => Math.abs(box[key] - rendered[key]) > tolerance
    )
    if (off) mismatches.push({ id, expected: box, actual: rendered })
  }
  return mismatches
}

export function formatBox({ x, y, width, height }: Box): string {
  return `${Math.round(x)},${Math.round(y)} ${Math.round(width)}×${Math.round(height)}`
}
