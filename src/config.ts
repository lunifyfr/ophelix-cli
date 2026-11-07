import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * La connexion gardée sur le poste, dans la configuration de l'utilisateur et jamais dans un
 * dépôt : `$OPHELIX_CONFIG_DIR`, sinon `$XDG_CONFIG_HOME/ophelix`, sinon `~/.config/ophelix`, en
 * droits 600 dans un dossier en 700. La clé y est en clair, comme celle d'un fichier `.env` :
 * c'est une clé de test, que `ophelix logout` révoque si le terminal l'a relevée.
 */
export interface StoredLogin {
  api_url: string
  key: string
  /** `device` : relevée après autorisation dans le tableau de bord. `pasted` : collée par la personne. */
  source: 'device' | 'pasted'
  organization?: { id: string; name: string }
  key_id?: string
  expires_at?: number | null
  created_at: number
}

export const DEFAULT_API_URL = 'https://api.ophelix.fr'

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPHELIX_CONFIG_DIR) return env.OPHELIX_CONFIG_DIR
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ophelix')
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json')
}

export function readLogin(env: NodeJS.ProcessEnv = process.env): StoredLogin | null {
  const path = configPath(env)
  if (!existsSync(path)) return null
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredLogin>
    return typeof stored.key === 'string' && typeof stored.api_url === 'string' ? (stored as StoredLogin) : null
  } catch {
    return null
  }
}

export function saveLogin(login: StoredLogin, env: NodeJS.ProcessEnv = process.env): string {
  const dir = configDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = configPath(env)
  // Le fichier naît en 600 ; chmod le remet à 600 s'il existait avec d'autres droits.
  writeFileSync(path, `${JSON.stringify(login, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

export function forgetLogin(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = configPath(env)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** Les droits du fichier, `0o600` attendu : `whoami` prévient s'ils se sont élargis. */
export function configMode(env: NodeJS.ProcessEnv = process.env): number | null {
  const path = configPath(env)
  return existsSync(path) ? statSync(path).mode & 0o777 : null
}
