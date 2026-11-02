import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type OpenPencil = {
  command: string
  args: string[]
}

export type Frame = {
  id: string
  name: string
  type: string
}

export class OpenPencilError extends Error {}

/** The OpenPencil revision unpen is tested against; its fixes for .pen files are not released yet. */
export const OPENPENCIL_REPO = 'https://github.com/open-pencil/open-pencil.git'
export const OPENPENCIL_COMMIT = '24461adec7073312d460d76f08f069de18e4fb78'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))

export function checkoutDir(): string {
  return join(root, '.openpencil')
}

export function bundledBun(): string {
  return join(dirname(require.resolve('bun/package.json')), 'bin/bun.exe')
}

function checkoutCli(checkout: string): string {
  return join(checkout, 'packages/cli/src/index.ts')
}

export type OpenPencilSource = 'checkout' | 'setup' | 'binary' | 'npm'

export function resolveOpenPencil(
  env: NodeJS.ProcessEnv = process.env
): OpenPencil & { source: OpenPencilSource } {
  const checkout = env.UNPEN_OPENPENCIL_CHECKOUT
  if (checkout) {
    return { source: 'checkout', command: env.UNPEN_BUN ?? bundledBun(), args: [checkoutCli(checkout)] }
  }
  if (env.UNPEN_OPENPENCIL) return { source: 'binary', command: env.UNPEN_OPENPENCIL, args: [] }
  if (existsSync(checkoutCli(checkoutDir()))) {
    return { source: 'setup', command: bundledBun(), args: [checkoutCli(checkoutDir())] }
  }
  const pkg = require.resolve('@open-pencil/cli/package.json')
  return { source: 'npm', command: process.execPath, args: [join(dirname(pkg), 'bin/openpencil.js')] }
}

const ANSI = /\u001b\[[0-9;]*m/g

/**
 * Runs the CLI with its output written to a file: Bun can exit before a pipe drains, which cuts
 * large JSON output short at the pipe's buffer size.
 */
export async function runOpenPencil(op: OpenPencil, args: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'unpen-op-'))
  const outFile = join(dir, 'stdout')
  const out = await open(outFile, 'w')
  try {
    const child = spawn(op.command, [...op.args, ...args], { stdio: ['ignore', out.fd, 'pipe'] })
    let stderr = ''
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    const code = await new Promise<number | null>((done, fail) => {
      child.on('error', fail)
      child.on('close', done)
    })
    await out.close()
    const stdout = await readFile(outFile, 'utf8')
    if (code !== 0) {
      const output = `${stderr}\n${stdout}`.replace(ANSI, '')
      throw new OpenPencilError(output.match(/ERROR\s+(.+)/)?.[1] ?? output.trim())
    }
    return stdout
  } finally {
    await out.close().catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
}

export async function topLevelFrames(op: OpenPencil, file: string): Promise<Frame[]> {
  const nodes: unknown = JSON.parse(await runOpenPencil(op, ['tree', file, '--depth', '1', '--json']))
  if (!Array.isArray(nodes)) throw new OpenPencilError('Unexpected tree output')
  return nodes.map(({ id, name, type }: Frame) => ({ id, name, type }))
}

export async function convertToFig(op: OpenPencil, file: string, output: string): Promise<void> {
  await runOpenPencil(op, ['convert', file, '-f', 'fig', '-o', output])
}

export async function exportHtml(
  op: OpenPencil,
  file: string,
  nodeId: string,
  output: string
): Promise<void> {
  await runOpenPencil(op, [
    'export',
    file,
    '-f',
    'html',
    '--html',
    'standalone',
    '--assets',
    'external',
    '--fonts',
    'assets',
    '--node',
    nodeId,
    '-o',
    output
  ])
}

export type TreeNode = Frame & {
  x: number
  y: number
  width: number
  height: number
  children?: TreeNode[]
}

export async function tree(op: OpenPencil, file: string): Promise<TreeNode[]> {
  const nodes: unknown = JSON.parse(await runOpenPencil(op, ['tree', file, '--json']))
  if (!Array.isArray(nodes)) throw new OpenPencilError('Unexpected tree output')
  return nodes as TreeNode[]
}

export async function tokensCss(op: OpenPencil, file: string): Promise<string> {
  return runOpenPencil(op, ['tokens', file, '--format', 'css'])
}

export type DocumentInfo = {
  totalNodes: number
  types: Record<string, number>
  fonts: string[]
}

export async function info(op: OpenPencil, file: string): Promise<DocumentInfo> {
  return JSON.parse(await runOpenPencil(op, ['info', file, '--json'])) as DocumentInfo
}
