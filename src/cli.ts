import { OphelixConnectionError, OphelixError } from '@ophelix/node'
import { type Args, parseArgs, UsageError } from './args'
import { listen } from './commands/listen'
import { login, logout, whoami } from './commands/login'
import { logs } from './commands/logs'
import { scenarios, trigger } from './commands/trigger'
import { CliError, type Context } from './context'
import { paint } from './format'
import { VERSION } from './version'

export const HELP = `ophelix ${VERSION} : l'outil en ligne de commande d'Ophelix, en mode test.

Usage : ophelix <commande> [options]

Commandes
  login                     Autorise ce terminal depuis le tableau de bord
  login --api-key <clé>     Se connecte avec une clé de test collée (sk_test_ ou rk_test_)
  logout                    Oublie la connexion, et révoque la clé que le terminal a relevée
  whoami                    Dit où l'outil est connecté
  listen                    Reçoit les événements du mode test sur ce poste
    --forward-to <adresse>    Les relaie, signés, vers un serveur local (localhost:3000/hooks)
    --events <motifs>         Ne garde que ces types : claim.*,batch.failed
    --print-secret            Affiche le secret de signature du relais, et s'arrête
  trigger <événement>       Fait arriver un événement par le simulateur (--list pour la liste)
    --vitale <scénario>       Carte Vitale de test, vitale_ok par défaut
    --cps <scénario>          Carte CPS de test, cps_doctor par défaut
  scenarios                 Liste les cartes et les retours du simulateur
  logs tail                 Suit les requêtes du mode test en direct
    --status <code>           404, 4xx ou 5xx
    --method <méthode>        GET, POST…

Options communes
  --api-key <clé>           Une clé de test, à la place de la connexion gardée (ou OPHELIX_API_KEY)
  --api-url <adresse>       Une autre API (ou OPHELIX_API_URL), https://api.ophelix.fr par défaut
  -h, --help                Cette aide
  -v, --version             La version

Documentation : https://docs.ophelix.fr/guides/ligne-de-commande`

const COMMANDS: Record<string, (args: Args, context: Context) => Promise<void>> = {
  login,
  logout,
  whoami,
  listen,
  trigger,
  scenarios,
  logs,
}

/** Lance une commande et rend le code de sortie. Aucune erreur ne sort d'ici sans être dite. */
export async function run(argv: string[], context: Context): Promise<number> {
  try {
    const args = parseArgs(argv)
    if (args.options.version === true) {
      context.out(VERSION)
      return 0
    }
    const command = args.positionals[0]
    if (command === undefined || args.options.help === true || command === 'help') {
      context.out(HELP)
      return 0
    }
    const handler = COMMANDS[command]
    if (!handler) throw new UsageError(`Commande inconnue : ${command}. \`ophelix --help\` les liste.`)
    await handler(args, context)
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      context.err(paint(context.color, 'red', error.message))
      return 2
    }
    if (error instanceof CliError) {
      context.err(paint(context.color, 'red', error.message))
      return error.exitCode
    }
    if (error instanceof OphelixConnectionError) {
      context.err(paint(context.color, 'red', 'L’API ne répond pas. Vérifiez la connexion, ou --api-url.'))
      return 1
    }
    if (error instanceof OphelixError) {
      context.err(paint(context.color, 'red', `${error.message}${error.requestId ? ` [${error.requestId}]` : ''}`))
      return 1
    }
    context.err(paint(context.color, 'red', `Erreur inattendue : ${(error as Error).message}`))
    return 1
  }
}
