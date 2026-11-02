import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import { runOpenPencil, tree, type OpenPencil, type TreeNode } from '../../src/openpencil.ts'

export type Box = { x: number; y: number; width: number; height: number }

export type TreeMismatch = { path: string; expected: string; actual: string }

function describe(node: TreeNode): string {
  return `${node.type} "${node.name}" ${Math.round(node.width)}×${Math.round(node.height)}`
}

/**
 * Walks two trees side by side and reports nodes whose type or name differ, and their size when
 * `tolerance` is given. A .pen tree is laid out with estimated text, so only a measured tree's
 * sizes are worth comparing.
 */
export function compareTrees(
  expected: readonly TreeNode[],
  actual: readonly TreeNode[],
  tolerance = Infinity,
  path = ''
): TreeMismatch[] {
  const mismatches: TreeMismatch[] = []
  const length = Math.max(expected.length, actual.length)
  for (let index = 0; index < length; index++) {
    const a = expected[index]
    const b = actual[index]
    const at = `${path}/${a?.name ?? b?.name ?? index}`
    if (!a || !b) {
      mismatches.push({ path: at, expected: a ? describe(a) : 'nothing', actual: b ? describe(b) : 'nothing' })
      continue
    }
    const sameSize =
      Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance
    if (a.type !== b.type || a.name !== b.name || !sameSize) {
      mismatches.push({ path: at, expected: describe(a), actual: describe(b) })
    }
    mismatches.push(...compareTrees(a.children ?? [], b.children ?? [], tolerance, at))
  }
  return mismatches
}

/**
 * Boxes of every layer under a top-level frame, relative to it, keyed by the .pen layer's id and
 * measured from the matching layer of the .fig, whose text was laid out in its real fonts.
 */
export function measuredBoxes(penFrame: TreeNode, figFrame: TreeNode): Map<string, Box> {
  const boxes = new Map<string, Box>()
  const visit = (pen: TreeNode, fig: TreeNode, offsetX: number, offsetY: number) => {
    const penChildren = pen.children ?? []
    const figChildren = fig.children ?? []
    for (const [index, penChild] of penChildren.entries()) {
      const figChild = figChildren[index]
      if (!figChild || figChild.name !== penChild.name) continue
      const x = offsetX + figChild.x
      const y = offsetY + figChild.y
      boxes.set(penChild.id, { x, y, width: figChild.width, height: figChild.height })
      visit(penChild, figChild, x, y)
    }
  }
  boxes.set(penFrame.id, { x: 0, y: 0, width: figFrame.width, height: figFrame.height })
  visit(penFrame, figFrame, 0, 0)
  return boxes
}

export async function renderPng(op: OpenPencil, file: string, nodeId: string, output: string) {
  await runOpenPencil(op, ['export', file, '-f', 'png', '--node', nodeId, '-o', output])
  return PNG.sync.read(await readFile(output))
}

/** Share of pixels that differ between two renders; a size change counts as fully different. */
export function pixelDifference(a: PNG, b: PNG): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  const changed = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 })
  return changed / (a.width * a.height)
}

export type FramePair = { name: string; penId: string; figId: string }

/** Top-level frames of a .pen and of the .fig made from it, matched by position. */
export async function framePairs(op: OpenPencil, pen: string, fig: string): Promise<FramePair[]> {
  const [penTree, figTree] = await Promise.all([tree(op, pen), tree(op, fig)])
  return penTree.flatMap((frame, index) => {
    const figFrame = figTree[index]
    return figFrame ? [{ name: frame.name, penId: frame.id, figId: figFrame.id }] : []
  })
}

export async function compareRenders(
  op: OpenPencil,
  pen: string,
  fig: string,
  pair: FramePair,
  dir: string
): Promise<number> {
  const [expected, actual] = await Promise.all([
    renderPng(op, pen, pair.penId, join(dir, `${pair.penId}-pen.png`)),
    renderPng(op, fig, pair.figId, join(dir, `${pair.penId}-fig.png`))
  ])
  return pixelDifference(expected, actual)
}
