import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { parseTargets } from '../src/convert.ts'

const run = promisify(execFile)
const cli = join(import.meta.dirname, '../src/cli.ts')
const fixture = join(import.meta.dirname, 'fixtures/card.pen')

test('maps target names to outputs', () => {
  assert.deepEqual([...parseTargets('openpencil,figma')], ['fig'])
  assert.deepEqual([...parseTargets('Doop, fig')], ['html', 'fig'])
  assert.throws(() => parseTargets('sketch'), /Unknown target "sketch"/)
})

test('converts a .pen file to .fig and per-frame HTML', { timeout: 300_000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'unpen-'))
  const { stdout } = await run(process.execPath, [cli, fixture, '-o', out])

  const dir = join(out, 'card')
  assert.ok(existsSync(join(dir, 'card.fig')))
  const pages = (await readdir(join(dir, 'html'))).filter((file) => file.endsWith('.html'))
  assert.deepEqual(pages.sort(), ['1-button.html', '2-profile-card.html', '3-unicode-frame.html'])
  assert.ok(existsSync(join(dir, 'html/manifest.json')))

  const html = await readFile(join(dir, 'html/2-profile-card.html'), 'utf8')
  assert.match(html, /^<!doctype html>/i)
  assert.match(html, /Follow/)

  const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'))
  assert.deepEqual(report.missingImages, ['assets/missing.png'])
  assert.match(stdout, /assets\/missing\.png/)
})

test('fails with usage when no input is given', async () => {
  await assert.rejects(run(process.execPath, [cli]), (error: { code: number; stdout: string }) => {
    assert.equal(error.code, 1)
    assert.match(error.stdout, /Usage: unpen/)
    return true
  })
})
