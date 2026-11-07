import { hostname } from 'node:os'
import { OphelixError } from '@ophelix/node'
import { type Args, stringOption } from '../args'
import { configPath, forgetLogin, readLogin, saveLogin } from '../config'
import { apiUrl, assertTestKey, CliError, type Context, client } from '../context'
import { paint } from '../format'

interface StartedLogin {
  device_code: string
  user_code: string
  verification_url: string
  expires_at: number
  interval: number
}

interface ExchangedLogin {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  secret?: string
  api_key?: string
  expires_at?: number | null
  organization?: { id: string; name: string }
}

/** Ce que /cli/v1 répond, ou son erreur au format commun de l'API. */
async function call<T>(context: Context, url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response
  try {
    response = await context.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    throw new CliError(`L'API ne répond pas à ${new URL(url).origin}. Vérifiez la connexion, ou --api-url.`)
  }
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!response.ok) throw new CliError(payload.error?.message ?? `L'API a répondu ${response.status}.`)
  return payload
}

/**
 * `ophelix login` : par défaut, un appareil autorisé depuis le tableau de bord. Le terminal montre
 * un code, ouvre la page qui le confirme, et relève sa clé une fois la demande autorisée.
 * `--api-key` garde à la place une clé de test collée, après l'avoir essayée.
 */
export async function login(args: Args, context: Context): Promise<void> {
  const baseUrl = apiUrl(args, context)
  const pasted = stringOption(args, 'api-key')

  if (pasted !== undefined) {
    assertTestKey(pasted)
    const { ophelix } = client(args, context)
    try {
      // Une lecture qui ne répond qu'en mode test et sans droit particulier : la clé vit, et elle est de test.
      await ophelix.testHelpers.scenarios()
    } catch (error) {
      throw new CliError(error instanceof OphelixError ? `Clé refusée : ${error.message}` : `L'API ne répond pas à ${baseUrl}.`)
    }
    const path = saveLogin(
      { api_url: baseUrl, key: pasted, source: 'pasted', created_at: Math.floor(context.now().getTime() / 1000) },
      context.env,
    )
    context.out(`${paint(context.color, 'green', '✔')} Connecté avec la clé ${hint(pasted)}, en mode test.`)
    context.out(paint(context.color, 'dim', `Gardée dans ${path}, en droits 600.`))
    return
  }

  const deviceName = stringOption(args, 'device-name') ?? hostname()
  const started = await call<StartedLogin>(context, `${baseUrl}/cli/v1/logins`, { device_name: deviceName.slice(0, 100) })

  context.out(`Votre code : ${paint(context.color, 'bold', started.user_code)}`)
  context.out(`Autorisez ce terminal dans le tableau de bord, en mode test : ${paint(context.color, 'cyan', started.verification_url)}`)
  if (args.options['no-browser'] !== true && context.openBrowser(started.verification_url)) {
    context.out(paint(context.color, 'dim', 'La page s’ouvre dans votre navigateur. Vérifiez que le code est le même.'))
  }
  context.out(paint(context.color, 'dim', 'En attente de l’autorisation… (^C pour abandonner)'))

  while (!context.signal.aborted) {
    await context.sleep(Math.max(1, started.interval) * 1000, context.signal)
    if (context.signal.aborted) break
    const exchanged = await call<ExchangedLogin>(context, `${baseUrl}/cli/v1/logins/token`, { device_code: started.device_code })

    if (exchanged.status === 'pending') continue
    if (exchanged.status === 'denied') throw new CliError('La connexion a été refusée dans le tableau de bord.')
    if (exchanged.status === 'expired') throw new CliError('Le code a expiré avant d’être autorisé. Relancez `ophelix login`.')

    const path = saveLogin(
      {
        api_url: baseUrl,
        key: exchanged.secret!,
        source: 'device',
        organization: exchanged.organization,
        key_id: exchanged.api_key,
        expires_at: exchanged.expires_at ?? null,
        created_at: Math.floor(context.now().getTime() / 1000),
      },
      context.env,
    )
    context.out(`${paint(context.color, 'green', '✔')} Connecté à ${exchanged.organization?.name ?? 'votre organisation'}, en mode test.`)
    context.out(
      paint(context.color, 'dim', `Clé ${hint(exchanged.secret!)} gardée dans ${path}, en droits 600. Elle expire dans 90 jours.`),
    )
    return
  }

  throw new CliError('Connexion abandonnée.', 130)
}

/** `ophelix logout` : oublie la connexion, et révoque la clé si c'est le terminal qui l'a relevée. */
export async function logout(args: Args, context: Context): Promise<void> {
  const stored = readLogin(context.env)
  if (!stored) {
    context.out('Aucune connexion à oublier.')
    return
  }
  if (stored.source === 'device') {
    try {
      await call(context, `${apiUrl(args, context, stored)}/cli/v1/logout`, {}, { Authorization: `Bearer ${stored.key}` })
      context.out(`Clé ${hint(stored.key)} révoquée.`)
    } catch (error) {
      context.err(`La clé n'a pas pu être révoquée (${(error as Error).message}). Révoquez-la dans Développeurs, Clés API.`)
    }
  }
  forgetLogin(context.env)
  context.out(`${paint(context.color, 'green', '✔')} Déconnecté : ${configPath(context.env)} supprimé.`)
}

/** `ophelix whoami` : où l'outil est connecté, sans jamais montrer la clé entière. */
export async function whoami(args: Args, context: Context): Promise<void> {
  const stored = readLogin(context.env)
  const key = stringOption(args, 'api-key') ?? context.env.OPHELIX_API_KEY ?? stored?.key
  if (!key) throw new CliError('Aucune connexion. Lancez `ophelix login`.')
  context.out(`API          ${apiUrl(args, context, stored)}`)
  context.out(`Clé          ${hint(key)} (mode test)`)
  if (stored?.organization && key === stored.key) context.out(`Organisation ${stored.organization.name}`)
  if (stored && key === stored.key) context.out(`Configuration ${configPath(context.env)}`)
}

/** `sk_test_…AbCd` : de quoi reconnaître une clé, pas de quoi s'en servir. */
export function hint(key: string): string {
  const prefix = key.match(/^(sk|rk)_(test|live)_/)?.[0] ?? ''
  return `${prefix}…${key.slice(-4)}`
}
