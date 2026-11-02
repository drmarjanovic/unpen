import { mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { basename, extname, join } from 'node:path'

import { repairHtmlPage } from './html.ts'
import {
  convertToFig,
  exportHtml,
  tokensCss,
  topLevelFrames,
  type OpenPencil
} from './openpencil.ts'
import { imageReferences } from './pen.ts'

export const TARGETS = {
  openpencil: 'fig',
  figma: 'fig',
  fig: 'fig',
  doop: 'html',
  html: 'html'
} as const

export type Target = keyof typeof TARGETS
export type Output = (typeof TARGETS)[Target]

export type HtmlFrame = {
  id: string
  name: string
  file: string
}

export type Report = {
  input: string
  outputDir: string
  fig?: { file: string } | { error: string }
  html?: { frames: HtmlFrame[]; failed: { id: string; name: string; error: string }[] }
  missingImages: string[]
  outsideImages: string[]
}

export function parseTargets(value: string): Set<Output> {
  const outputs = new Set<Output>()
  for (const raw of value.split(',')) {
    const name = raw.trim().toLowerCase()
    if (!(name in TARGETS)) {
      throw new Error(`Unknown target "${raw}". Use ${Object.keys(TARGETS).join(', ')}.`)
    }
    outputs.add(TARGETS[name as Target])
  }
  return outputs
}

const HTML_CONCURRENCY = Math.max(1, Math.min(4, availableParallelism() - 1))

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      await task(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'frame'
  )
}

export async function convert(
  op: OpenPencil,
  input: string,
  outputs: Set<Output>,
  outRoot: string
): Promise<Report> {
  const name = basename(input, extname(input))
  const outputDir = join(outRoot, name)
  await mkdir(outputDir, { recursive: true })

  const images = await imageReferences(input)
  const report: Report = {
    input,
    outputDir,
    missingImages: images
      .filter((image) => image.kind === 'local' && !image.found)
      .map((image) => image.url),
    outsideImages: images.filter((image) => image.kind === 'outside').map((image) => image.url)
  }

  const writeFig = async () => {
    const file = join(outputDir, `${name}.fig`)
    try {
      await convertToFig(op, input, file)
      report.fig = { file }
    } catch (error) {
      report.fig = { error: message(error) }
    }
  }

  const writeHtml = async () => {
    const htmlDir = join(outputDir, 'html')
    await mkdir(htmlDir, { recursive: true })
    const frames: HtmlFrame[] = []
    const failed: { id: string; name: string; error: string }[] = []
    const [topLevel, tokens] = await Promise.all([topLevelFrames(op, input), tokensCss(op, input)])
    const width = String(topLevel.length).length
    await mapLimit(topLevel, HTML_CONCURRENCY, async (frame, index) => {
      const file = join(htmlDir, `${String(index + 1).padStart(width, '0')}-${slug(frame.name)}.html`)
      try {
        await exportHtml(op, input, frame.id, file)
        await repairHtmlPage(file, tokens)
        frames.push({ id: frame.id, name: frame.name, file })
      } catch (error) {
        failed.push({ ...frame, error: message(error) })
      }
    })
    frames.sort((a, b) => a.file.localeCompare(b.file))
    report.html = { frames, failed }
    await writeFile(join(htmlDir, 'manifest.json'), `${JSON.stringify(frames, null, 2)}\n`)
  }

  await Promise.all([
    outputs.has('fig') ? writeFig() : undefined,
    outputs.has('html') ? writeHtml() : undefined
  ])

  await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function succeeded(report: Report): boolean {
  const figOk = !report.fig || 'file' in report.fig
  const htmlOk = !report.html || report.html.failed.length === 0
  return figOk && htmlOk
}
