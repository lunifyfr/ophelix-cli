import { OphelixError } from '@ophelix/node'
import { type Args, stringOption, UsageError } from '../args'
import { CliError, type Context, client } from '../context'
import { paint } from '../format'
import { findTrigger, TRIGGERS } from '../triggers'

/** La date du jour sur ce poste, AAAA-MM-JJ : la date des soins d'une facture de test. */
export function today(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-')
}

/**
 * `ophelix trigger <événement>` : fait arriver l'événement en mode test, par les routes publiques
 * du simulateur. Les objets créés sont des objets de test comme les autres : ils restent dans le
 * tableau de bord, et `ophelix listen` relaie leurs événements.
 */
export async function trigger(args: Args, context: Context): Promise<void> {
  const event = args.positionals[1]
  if (args.options.list === true || event === undefined) {
    context.out('Événements que le mode test sait déclencher :')
    const width = Math.max(...TRIGGERS.map(item => item.event.length))
    for (const item of TRIGGERS) context.out(`  ${item.event.padEnd(width)}  ${paint(context.color, 'dim', item.description)}`)
    context.out(paint(context.color, 'dim', 'Les cartes de test se listent par `ophelix scenarios`.'))
    if (event === undefined && args.options.list !== true)
      throw new UsageError('Usage : ophelix trigger <événement> [--vitale vitale_ok] [--cps cps_doctor]')
    return
  }

  const found = findTrigger(event)
  if (!found) throw new UsageError(`Le mode test ne sait pas déclencher « ${event} ». \`ophelix trigger --list\` donne la liste.`)

  const { ophelix } = client(args, context)
  const options = {
    vitale: stringOption(args, 'vitale') ?? 'vitale_ok',
    cps: stringOption(args, 'cps') ?? 'cps_doctor',
    serviceDate: stringOption(args, 'service-date') ?? today(context.now()),
  }

  context.out(`Déclenchement de ${paint(context.color, 'bold', found.event)}…`)
  try {
    await found.run(ophelix, options, (route, id, detail) => {
      context.out(`  ${paint(context.color, 'dim', route)}  ${id}${detail ? paint(context.color, 'dim', ` (${detail})`) : ''}`)
    })
  } catch (error) {
    if (error instanceof OphelixError) {
      throw new CliError(
        `L'API a refusé une étape : ${error.message}${error.code ? ` (${error.code})` : ''}${error.requestId ? ` [${error.requestId}]` : ''}`,
      )
    }
    throw error
  }
  context.out(`${paint(context.color, 'green', '✔')} ${found.event} déclenché. Ses événements arrivent dans \`ophelix listen\`.`)
}

/** `ophelix scenarios` : les cartes et les retours du simulateur, par `GET /v1/test-helpers/scenarios`. */
export async function scenarios(args: Args, context: Context): Promise<void> {
  const { ophelix } = client(args, context)
  const list = await ophelix.testHelpers.scenarios()
  const families: Array<[string, Record<string, string>]> = [
    ['Cartes Vitale (--vitale)', list.vitale_cards as unknown as Record<string, string>],
    ['Cartes CPS (--cps)', list.cps_cards as unknown as Record<string, string>],
    ['Retours', list.returns as unknown as Record<string, string>],
  ]
  for (const [title, scenarios] of families) {
    context.out(paint(context.color, 'bold', title))
    const width = Math.max(0, ...Object.keys(scenarios).map(key => key.length))
    for (const [key, label] of Object.entries(scenarios)) context.out(`  ${key.padEnd(width)}  ${paint(context.color, 'dim', label)}`)
  }
}
