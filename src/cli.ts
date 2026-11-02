#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { TARGETS, convert, parseTargets, succeeded, type Report } from './convert.ts'
import { resolveOpenPencil } from './openpencil.ts'

const USAGE = `Usage: unpen <file.pen...> [options]

Options:
  -t, --to <targets>   Comma-separated: ${Object.keys(TARGETS).join(', ')} (default: openpencil,figma,doop)
  -o, --out <dir>      Output directory (default: ./unpen-out)
  -h, --help           Show this help

Outputs per input, in <out>/<name>/:
  <name>.fig           Opens in OpenPencil and imports into Figma
  html/*.html          One standalone page per top-level frame, for Doop (experimental)
  report.json          What was written, what failed, and missing images`

function summarize(report: Report): string {
  const lines = [`${report.input}`]
  if (report.fig) {
    lines.push('file' in report.fig ? `  ✓ fig   ${report.fig.file}` : `  ✗ fig   ${report.fig.error}`)
  }
  if (report.html) {
    lines.push(`  ✓ html  ${report.html.frames.length} frames (experimental: layout is not accurate yet)`)
    for (const frame of report.html.failed) lines.push(`  ✗ html  ${frame.name}: ${frame.error}`)
  }
  if (report.missingImages.length > 0) {
    lines.push(`  ! ${report.missingImages.length} images not found next to the file:`)
    for (const url of report.missingImages) lines.push(`      ${url}`)
  }
  if (report.outsideImages.length > 0) {
    lines.push(`  ! ${report.outsideImages.length} images point outside the file's folder and are skipped:`)
    for (const url of report.outsideImages) lines.push(`      ${url}`)
  }
  return lines.join('\n')
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      to: { type: 'string', short: 't', default: 'openpencil,figma,doop' },
      out: { type: 'string', short: 'o', default: 'unpen-out' },
      help: { type: 'boolean', short: 'h', default: false }
    }
  })

  if (values.help || positionals.length === 0) {
    console.log(USAGE)
    return values.help ? 0 : 1
  }

  const outputs = parseTargets(values.to)
  const op = resolveOpenPencil()
  if (op.source === 'npm') {
    console.error(
      'Warning: using the published OpenPencil 0.16.0, which fails on many .pen files.\n' +
        'Run `npm run setup` once to use the tested revision.\n'
    )
  }
  let ok = true
  for (const input of positionals) {
    const report = await convert(op, resolve(input), outputs, resolve(values.out))
    console.log(summarize(report))
    ok &&= succeeded(report)
  }
  return ok ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
