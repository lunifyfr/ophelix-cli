/**
 * Bâtit l'outil : `dist/ophelix.js`, un seul fichier pour Node 20.3 et plus, sans dépendance (la
 * bibliothèque Node du dépôt y est incluse), et `dist/ophelix`, un binaire autonome pour ce poste.
 *
 *   bun scripts/build.ts                                     # les deux, pour ce poste
 *   bun scripts/build.ts --targets bun-linux-x64,bun-darwin-arm64   # binaires d'autres systèmes
 */
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')
const entry = join(root, 'src', 'main.ts')
const flag = process.argv.indexOf('--targets')
const targets = flag === -1 ? [] : (process.argv[flag + 1] ?? '').split(',').filter(Boolean)

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const bundle = await Bun.build({ entrypoints: [entry], target: 'node', format: 'esm', minify: false, outdir: dist, naming: 'ophelix.js' })
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  process.exit(1)
}
chmodSync(join(dist, 'ophelix.js'), 0o755)

for (const target of targets.length ? targets : [undefined]) {
  const outfile = join(dist, target ? `ophelix-${target.replace(/^bun-/, '')}` : 'ophelix')
  const args = ['build', entry, '--compile', '--minify', '--outfile', outfile, ...(target ? ['--target', target] : [])]
  const built = Bun.spawnSync(['bun', ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' })
  if (built.exitCode !== 0) process.exit(built.exitCode ?? 1)
}
