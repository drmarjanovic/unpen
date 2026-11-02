import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { fidelitySuite } from '../helpers/suite.ts'

const dir = process.env.UNPEN_SAMPLES ?? join(import.meta.dirname, '../../samples')
const samples = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.pen')) : []

if (samples.length === 0) {
  test('samples', { skip: `no .pen files in ${dir}` }, () => {})
}

for (const sample of samples) fidelitySuite(join(dir, sample), { timeout: 3_600_000 })
