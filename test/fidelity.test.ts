import { join } from 'node:path'

import { fidelitySuite } from './helpers/suite.ts'

fidelitySuite(join(import.meta.dirname, 'fixtures/card.pen'))
