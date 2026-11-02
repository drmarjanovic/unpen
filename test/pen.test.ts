import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { imageReferences, imageUrls } from '../src/pen.ts'

const fixture = join(import.meta.dirname, 'fixtures/card.pen')

test('collects image urls from fills, strokes, children and overrides', () => {
  const doc = {
    children: [
      {
        fill: { type: 'image', url: 'a.png' },
        stroke: { fill: [{ type: 'image', url: 'b.png' }] },
        children: [{ fill: ['#fff', { type: 'image', url: 'c.png' }] }],
        descendants: { x: { fill: { type: 'image', url: 'd.png' } } }
      },
      { fill: { type: 'image', url: 'a.png' } }
    ]
  }
  assert.deepEqual(imageUrls(doc), ['a.png', 'b.png', 'c.png', 'd.png'])
})

test('ignores documents without children', () => {
  assert.deepEqual(imageUrls(null), [])
  assert.deepEqual(imageUrls({ children: 'nope' }), [])
})

test('classifies images outside the folder, remote and embedded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unpen-pen-'))
  const file = join(dir, 'doc.pen')
  const urls = ['../up.png', '/abs.png', 'https://x.test/a.png', 'data:image/png;base64,AA==']
  await writeFile(
    file,
    JSON.stringify({ children: urls.map((url) => ({ fill: { type: 'image', url } })) })
  )
  assert.deepEqual(
    (await imageReferences(file)).map(({ kind, found }) => [kind, found]),
    [
      ['outside', false],
      ['outside', false],
      ['remote', true],
      ['embedded', true]
    ]
  )
})

test('reports which local images exist next to the file', async () => {
  assert.deepEqual(await imageReferences(fixture), [
    { url: 'assets/dot.png', kind: 'local', found: true },
    { url: 'assets/missing.png', kind: 'local', found: false }
  ])
})
