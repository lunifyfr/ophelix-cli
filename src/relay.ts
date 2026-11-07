import { generateTestHeader, SIGNATURE_HEADER } from '@ophelix/node'
import type { Context } from './context'

/** Le délai d'un serveur local, comme celui d'une vraie livraison. */
const TIMEOUT = 10_000

/**
 * Le relais ne parle qu'à ce poste : `localhost`, un nom en `.localhost`, `127.0.0.1` ou `[::1]`.
 * Une autre adresse ferait sortir les événements vers une machine qu'on ne voit pas.
 */
export function isLocalUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const local =
    url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && local
}

/** `localhost:3000/hooks` se lit `http://localhost:3000/hooks`. */
export function normalizeUrl(value: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

/** Sans motif, tout passe. `claim.*` prend une famille, `*` prend tout, le reste un type exact. */
export function patternMatches(patterns: string[], type: string): boolean {
  return (
    patterns.length === 0 ||
    patterns.some(pattern => pattern === '*' || pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))))
  )
}

export interface Forwarded {
  status: number | null
  durationMs: number
  error?: string
}

/**
 * Une livraison comme celles d'Ophelix : le corps exact, signé par le secret du relais, sans
 * suivre de redirection. Le corps et la réponse du serveur local ne se gardent pas.
 */
export async function forward(context: Context, url: string, body: string, secret: string): Promise<Forwarded> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  try {
    const response = await context.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Ophelix-CLI/1.0',
        [SIGNATURE_HEADER]: generateTestHeader({ payload: body, secret }),
      },
      body,
    })
    await response.arrayBuffer().catch(() => undefined)
    return { status: response.status, durationMs: elapsed() }
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError'
    return { status: null, durationMs: elapsed(), error: timedOut ? 'délai dépassé' : 'connexion impossible' }
  }
}
