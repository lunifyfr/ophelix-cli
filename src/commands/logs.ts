import { type Args, stringOption, UsageError } from '../args'
import { type Context, client } from '../context'
import { followFeed } from '../feed'
import { clock, paint, statusTone } from '../format'

/** `404` vise un code, `4xx` une famille. */
export function statusMatches(filter: string | undefined, status: number): boolean {
  if (filter === undefined) return true
  return filter
    .split(',')
    .map(part => part.trim().toLowerCase())
    .some(part => (/^\dxx$/.test(part) ? Math.floor(status / 100) === Number(part[0]) : Number(part) === status))
}

/**
 * `ophelix logs tail` : les requêtes du mode test, en direct, celles de l'outil comme celles de
 * l'intégration. Le corps n'apparaît pas : `GET /v1/requests/{id}` le donne, et le tableau de bord
 * aussi.
 */
export async function logs(args: Args, context: Context): Promise<void> {
  if (args.positionals[1] !== 'tail') throw new UsageError('Usage : ophelix logs tail [--status 4xx] [--method POST]')
  const status = stringOption(args, 'status')
  if (status !== undefined && !/^(\d{3}|\dxx)(,(\d{3}|\dxx))*$/i.test(status))
    throw new UsageError('--status attend un code (404) ou une famille (4xx).')
  const method = stringOption(args, 'method')?.toUpperCase()
  const { ophelix } = client(args, context)

  let ready = false
  for await (const page of followFeed(ophelix, context)) {
    if (!ready) {
      context.out(`${paint(context.color, 'green', 'Prêt.')} Les requêtes du mode test s'affichent ici. ^C pour arrêter.`)
      ready = true
    }
    for (const request of page.requests) {
      if (!statusMatches(status, request.status) || (method !== undefined && request.method !== method)) continue
      const code = request.error_code ? ` ${paint(context.color, statusTone(request.status), request.error_code)}` : ''
      context.out(
        `${paint(context.color, 'dim', clock(new Date(request.created * 1000)))}  ${paint(context.color, statusTone(request.status), String(request.status))}  ${request.method} ${request.path}${code}  [${request.id}] ${request.duration_ms} ms`,
      )
    }
  }
}
