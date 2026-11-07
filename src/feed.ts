import { type Ophelix, OphelixAuthenticationError, OphelixPermissionError, type TestFeed } from '@ophelix/node'
import { CliError, type Context } from './context'
import { paint } from './format'

/** Ce que rend une lecture au plus, par famille : une page pleine se relit sans attendre. */
const PAGE = 100

/**
 * Relève le fil du mode test (`GET /v1/test-helpers/feed`) jusqu'à ^C. La première lecture pose
 * les curseurs à l'instant présent : rien de l'historique ne remonte. Une coupure se reprend
 * seule ; une clé refusée arrête tout, puisque rien ne la réparera.
 */
export async function* followFeed(ophelix: Ophelix, context: Context): AsyncGenerator<TestFeed> {
  let feed = await read(ophelix, {})
  let interval = feed.poll_interval
  let failing = false
  yield feed

  while (!context.signal.aborted) {
    const full = feed.events.length >= PAGE || feed.requests.length >= PAGE
    if (!full) await context.sleep(interval * 1000, context.signal)
    if (context.signal.aborted) return

    try {
      feed = await read(ophelix, { events_after: feed.events_cursor, requests_after: feed.requests_cursor })
    } catch (error) {
      if (error instanceof CliError) throw error
      if (!failing) context.err(paint(context.color, 'yellow', 'L’API ne répond plus. Nouvel essai en continu…'))
      failing = true
      interval = Math.min(interval * 2, 30)
      continue
    }
    if (failing) context.err(paint(context.color, 'green', 'L’API répond de nouveau.'))
    failing = false
    interval = feed.poll_interval
    yield feed
  }
}

async function read(ophelix: Ophelix, cursors: { events_after?: string; requests_after?: string }): Promise<TestFeed> {
  try {
    return await ophelix.testHelpers.feed(cursors)
  } catch (error) {
    if (error instanceof OphelixAuthenticationError) {
      throw new CliError('La clé est refusée : révoquée ou expirée. Relancez `ophelix login`.')
    }
    if (error instanceof OphelixPermissionError) {
      throw new CliError(`${error.message} Il faut une clé de test qui lit les événements et les requêtes.`)
    }
    throw error
  }
}
