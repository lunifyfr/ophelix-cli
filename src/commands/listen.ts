import { type Args, listOption, stringOption, UsageError } from '../args'
import { type Context, client } from '../context'
import { followFeed } from '../feed'
import { clock, paint, statusTone } from '../format'
import { forward, isLocalUrl, normalizeUrl, patternMatches } from '../relay'

/**
 * `ophelix listen` : reçoit les événements du mode test sur ce poste, sans tunnel ni port ouvert.
 * L'outil relève le fil de l'API, et rejoue chaque événement vers `--forward-to`, signé par le
 * secret du relais. Sans `--forward-to`, il les affiche seulement.
 */
export async function listen(args: Args, context: Context): Promise<void> {
  const target = stringOption(args, 'forward-to')
  const url = target === undefined ? undefined : normalizeUrl(target)
  if (url !== undefined && !isLocalUrl(url)) {
    throw new UsageError(
      '--forward-to vise ce poste : localhost, 127.0.0.1 ou [::1]. Un serveur distant reçoit les webhooks par un point de terminaison.',
    )
  }
  const patterns = listOption(args, 'events')
  const { ophelix } = client(args, context)
  const feed = followFeed(ophelix, context)

  const first = await feed.next()
  if (first.done) return
  const secret = first.value.signing_secret

  if (args.options['print-secret'] === true) {
    context.out(secret)
    return
  }

  context.out(`${paint(context.color, 'green', 'Prêt.')} Secret de signature du relais : ${paint(context.color, 'bold', secret)}`)
  context.out(
    paint(
      context.color,
      'dim',
      `${url ? `Relais vers ${url}` : 'Affichage seul, sans --forward-to'}${patterns.length ? `, événements ${patterns.join(', ')}` : ', tous les événements'}. ^C pour arrêter.`,
    ),
  )

  for await (const page of feed) {
    for (const event of page.events) {
      if (!patternMatches(patterns, event.type)) continue
      const at = clock(context.now())
      context.out(`${paint(context.color, 'dim', at)}  --> ${paint(context.color, 'bold', event.type)} [${event.id}]`)
      if (!url) continue
      const result = await forward(context, url, event.body, secret)
      const status = result.status === null ? `[${result.error}]` : `[${result.status}]`
      context.out(
        `${paint(context.color, 'dim', clock(context.now()))}  <-- ${paint(context.color, statusTone(result.status), status)} POST ${url} [${event.id}] ${result.durationMs} ms`,
      )
    }
  }
}
