import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'

import type { Browser } from 'playwright'

import { convert, type HtmlFrame } from '../../src/convert.ts'
import { info, resolveOpenPencil, tree, type TreeNode } from '../../src/openpencil.ts'
import {
  checkPage,
  compareBoxes,
  formatBox,
  launchBrowser,
  serve,
  type PageCheck,
  type StaticServer
} from './browser.ts'
import { compareRenders, compareTrees, framePairs, measuredBoxes } from './fidelity.ts'

// Text-heavy frames differ by up to ~2% from glyph edges landing a fraction of a pixel apart.
const MAX_PIXEL_DIFFERENCE = 0.025
const LIST_LIMIT = 10
const KNOWN_LAYOUT_ISSUE =
  'OpenPencil HTML export positions auto-layout children absolutely, so containers that hug their content collapse'

function list(lines: string[]): string {
  const shown = lines.slice(0, LIST_LIMIT).map((line) => `  ${line}`)
  if (lines.length > LIST_LIMIT) shown.push(`  …and ${lines.length - LIST_LIMIT} more`)
  return shown.join('\n')
}

/** Converts `pen` to every output and checks each against the design it came from. */
export function fidelitySuite(pen: string, options: { timeout?: number } = {}) {
  const timeout = options.timeout ?? 600_000
  const name = basename(pen, extname(pen))
  const op = resolveOpenPencil()
  let dir = ''
  let fig = ''
  let frames: HtmlFrame[] = []
  let penTree: TreeNode[] = []
  let figTree: TreeNode[] = []

  describe(name, { timeout }, () => {
    before(async () => {
      const out = await mkdtemp(join(tmpdir(), 'unpen-fidelity-'))
      const report = await convert(op, pen, new Set(['fig', 'html']), out)
      dir = report.outputDir
      assert.ok(report.fig && 'file' in report.fig, `fig failed: ${JSON.stringify(report.fig)}`)
      fig = report.fig.file
      frames = report.html?.frames ?? []
      ;[penTree, figTree] = await Promise.all([tree(op, pen), tree(op, fig)])
    })

    describe('fig', () => {
      test('keeps every node', async () => {
        const [source, output] = await Promise.all([info(op, pen), info(op, fig)])
        assert.deepEqual(output.types, source.types)
        assert.equal(output.totalNodes, source.totalNodes)
      })

      test('keeps every layer name and type', () => {
        const mismatches = compareTrees(penTree, figTree)
        assert.equal(
          mismatches.length,
          0,
          `\n${list(mismatches.map((m) => `${m.path}: ${m.expected} → ${m.actual}`))}`
        )
      })

      test('renders like the design', async () => {
        const renders = join(dir, 'renders')
        await mkdir(renders, { recursive: true })
        const differing: string[] = []
        for (const pair of await framePairs(op, pen, fig)) {
          const difference = await compareRenders(op, pen, fig, pair, renders)
          if (difference > MAX_PIXEL_DIFFERENCE) {
            differing.push(`${pair.name}: ${(difference * 100).toFixed(1)}% of pixels differ`)
          }
        }
        assert.equal(differing.length, 0, `renders in ${renders}\n${list(differing)}`)
      })
    })

    describe('html', () => {
      let browser: Browser | undefined
      let server: StaticServer | undefined
      const checks = new Map<string, PageCheck>()

      before(async () => {
        browser = await launchBrowser()
        server = await serve(dir)
        const measured = new Map(penTree.map((frame, index) => [frame.id, figTree[index] ?? frame]))
        for (const frame of frames) {
          const design = measured.get(frame.id)
          if (!design) continue
          checks.set(frame.id, await checkPage(browser, server.url(frame.file), design))
        }
      })

      after(async () => {
        await browser?.close()
        await server?.close()
      })

      test('writes a page per top-level frame', async () => {
        assert.deepEqual(
          frames.map((frame) => frame.id),
          penTree.map((frame) => frame.id)
        )
        const manifest = JSON.parse(await readFile(join(dir, 'html/manifest.json'), 'utf8'))
        assert.equal(manifest.length, frames.length)
      })

      test('loads every asset', () => {
        const failed = [...checks.entries()].flatMap(([id, check]) =>
          check.failedRequests.map((url) => `${id}: ${url}`)
        )
        assert.equal(failed.length, 0, `\n${list(failed)}`)
      })

      test('defines every CSS variable it uses', () => {
        const missing = [...new Set([...checks.values()].flatMap((check) => check.undefinedVariables))]
        assert.equal(missing.length, 0, `\n${list(missing)}`)
      })

      test('loads every font it uses', () => {
        const missing = [...new Set([...checks.values()].flatMap((check) => check.unloadedFonts))]
        assert.equal(missing.length, 0, `\n${list(missing)}`)
      })

      test('lays out every layer where the design puts it', { todo: KNOWN_LAYOUT_ISSUE }, () => {
        const misplaced: string[] = []
        for (const [index, frame] of penTree.entries()) {
          const check = checks.get(frame.id)
          const figFrame = figTree[index]
          if (!check || !figFrame) continue
          for (const m of compareBoxes(measuredBoxes(frame, figFrame), check.boxes)) {
            misplaced.push(`${frame.name} › ${m.id}: ${formatBox(m.expected)} → ${formatBox(m.actual)}`)
          }
        }
        assert.equal(misplaced.length, 0, `${misplaced.length} layers off\n${list(misplaced)}`)
      })
    })
  })
}
