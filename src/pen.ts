import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type PenNode = {
  fill?: unknown
  stroke?: unknown
  children?: PenNode[]
  descendants?: Record<string, PenNode>
}

export type ImageReference = {
  url: string
  kind: 'local' | 'outside' | 'embedded' | 'remote'
  found: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function paintUrls(paint: unknown, urls: Set<string>) {
  if (Array.isArray(paint)) {
    for (const item of paint) paintUrls(item, urls)
    return
  }
  if (!isRecord(paint)) return
  if (paint.type === 'image' && typeof paint.url === 'string') urls.add(paint.url)
  if ('fill' in paint) paintUrls(paint.fill, urls)
}

function collect(node: PenNode, urls: Set<string>) {
  paintUrls(node.fill, urls)
  paintUrls(node.stroke, urls)
  for (const child of node.children ?? []) collect(child, urls)
  for (const override of Object.values(node.descendants ?? {})) collect(override, urls)
}

export function imageUrls(doc: unknown): string[] {
  const urls = new Set<string>()
  if (isRecord(doc) && Array.isArray(doc.children)) {
    for (const child of doc.children) if (isRecord(child)) collect(child, urls)
  }
  return [...urls]
}

function kindOf(url: string): ImageReference['kind'] {
  if (/^data:/i.test(url)) return 'embedded'
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return 'remote'
  if (url.startsWith('/') || url.startsWith('\\') || url.split(/[/\\]/).includes('..')) {
    return 'outside'
  }
  return 'local'
}

export async function imageReferences(file: string): Promise<ImageReference[]> {
  const doc: unknown = JSON.parse(await readFile(file, 'utf8'))
  return imageUrls(doc).map((url) => {
    const kind = kindOf(url)
    const found = kind === 'local' ? existsSync(join(dirname(file), url)) : kind !== 'outside'
    return { url, kind, found }
  })
}
