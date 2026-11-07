import { Ophelix } from '@ophelix/node'
import { type Args, stringOption, UsageError } from './args'
import { DEFAULT_API_URL, readLogin, type StoredLogin } from './config'

/**
 * Tout ce qu'une commande touche hors d'elle-même : l'environnement, les sorties, le réseau et le
 * temps. `main` donne les vrais, les tests les remplacent.
 */
export interface Context {
  env: NodeJS.ProcessEnv
  out: (line: string) => void
  err: (line: string) => void
  fetch: typeof fetch
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  now: () => Date
  /** S'arrête sur ^C : `listen` et `logs tail` tournent jusque-là. */
  signal: AbortSignal
  color: boolean
  /** Ouvre une adresse dans le navigateur. Rend faux si rien ne s'est ouvert. */
  openBrowser: (url: string) => boolean
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message)
  }
}

export function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** L'adresse de l'API : l'option, puis l'environnement, puis la connexion gardée, puis la production. */
export function apiUrl(args: Args, context: Context, stored: StoredLogin | null = readLogin(context.env)): string {
  return (stringOption(args, 'api-url') ?? context.env.OPHELIX_API_URL ?? stored?.api_url ?? DEFAULT_API_URL).replace(/\/+$/, '')
}

/** Une clé de production ne passe jamais par l'outil : il ne travaille qu'en mode test. */
export function assertTestKey(key: string): void {
  if (/^(sk|rk)_live_/.test(key)) {
    throw new UsageError('Cette clé est une clé de production. L’outil ne travaille qu’en mode test : collez une clé sk_test_ ou rk_test_.')
  }
  if (!/^(sk|rk)_test_\S+$/.test(key)) {
    throw new UsageError('Une clé de test commence par sk_test_ ou rk_test_.')
  }
}

/**
 * Le client de l'API, avec la clé de l'option `--api-key`, de `OPHELIX_API_KEY` ou de la connexion
 * gardée. Sans clé, l'outil dit comment se connecter.
 */
export function client(args: Args, context: Context): { ophelix: Ophelix; key: string; baseUrl: string } {
  const stored = readLogin(context.env)
  const key = stringOption(args, 'api-key') ?? context.env.OPHELIX_API_KEY ?? stored?.key
  if (!key) throw new CliError('Aucune connexion. Lancez `ophelix login`, ou passez une clé de test par --api-key ou OPHELIX_API_KEY.')
  assertTestKey(key)
  const baseUrl = apiUrl(args, context, stored)
  return { ophelix: new Ophelix(key, { baseUrl, fetch: context.fetch, maxRetries: 1 }), key, baseUrl }
}
