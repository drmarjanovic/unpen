import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/**
 * Works around two gaps in OpenPencil's external-asset HTML export: its stylesheet names fonts
 * relative to the page instead of to itself, and it uses the document's variables without
 * defining them. `tokens` is the document's variables as CSS custom properties.
 */
export async function repairHtmlPage(page: string, tokens: string): Promise<void> {
  const assets = join(dirname(page), `${basename(page, extname(page))}.assets`)
  if (!existsSync(assets)) return
  const prefix = `${basename(assets)}/`
  for (const file of await readdir(assets)) {
    if (extname(file) !== '.css') continue
    const path = join(assets, file)
    let css = (await readFile(path, 'utf8')).replaceAll(`url("${prefix}`, 'url("')
    if (tokens && css.includes('var(--')) css = `${tokens.trim()}\n${css}`
    await writeFile(path, css)
  }
}
