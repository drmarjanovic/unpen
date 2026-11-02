import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { OPENPENCIL_COMMIT, OPENPENCIL_REPO, bundledBun, checkoutDir } from '../src/openpencil.ts'

function run(command: string, args: string[], cwd?: string) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`Setup failed: ${command} exited with ${result.status}`)
    process.exit(1)
  }
}

const dir = checkoutDir()
const bun = bundledBun()

if (!existsSync(dir)) run('git', ['clone', '--filter=blob:none', OPENPENCIL_REPO, dir])
run('git', ['fetch', '--quiet', 'origin', OPENPENCIL_COMMIT], dir)
run('git', ['checkout', '--quiet', '--detach', OPENPENCIL_COMMIT], dir)
run(bun, ['install', '--frozen-lockfile'], dir)
run(bun, ['run', 'build:packages'], dir)
console.log(`\nOpenPencil ${OPENPENCIL_COMMIT.slice(0, 9)} is ready in ${dir}`)
