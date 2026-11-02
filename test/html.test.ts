import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { repairHtmlPage } from '../src/html.ts'

const TOKENS = ':root {\n  --color-brand: #1F6FEB;\n}\n'

async function page(css: string) {
  const dir = await mkdtemp(join(tmpdir(), 'unpen-html-'))
  const assets = join(dir, '1-card.assets')
  await mkdir(assets)
  await writeFile(join(dir, '1-card.html'), '<link rel="stylesheet" href="1-card.assets/openpencil.css">')
  await writeFile(join(assets, 'openpencil.css'), css)
  return { html: join(dir, '1-card.html'), css: join(assets, 'openpencil.css') }
}

test('points font urls at the stylesheet folder and defines the variables it uses', async () => {
  const files = await page(
    '@font-face { src: url("1-card.assets/fonts/inter.woff2"); }.a{color: var(--color-brand)}'
  )
  await repairHtmlPage(files.html, TOKENS)
  assert.equal(
    await readFile(files.css, 'utf8'),
    ':root {\n  --color-brand: #1F6FEB;\n}\n@font-face { src: url("fonts/inter.woff2"); }.a{color: var(--color-brand)}'
  )
})

test('leaves stylesheets without variables alone', async () => {
  const files = await page('.a{color: red}')
  await repairHtmlPage(files.html, TOKENS)
  assert.equal(await readFile(files.css, 'utf8'), '.a{color: red}')
})

test('ignores pages without an assets folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unpen-html-'))
  await writeFile(join(dir, 'page.html'), '<p>inline</p>')
  await repairHtmlPage(join(dir, 'page.html'), TOKENS)
})
