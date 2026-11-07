/** Ce que la ligne de commande donne : les mots, puis les options. */
export interface Args {
  positionals: string[]
  options: Record<string, string | true>
}

/** Une option qui n'attend pas de valeur. Les autres prennent le mot suivant, ou ce qui suit `=`. */
const BOOLEANS = new Set(['help', 'version', 'no-browser', 'print-secret', 'list', 'json', 'skip-verify'])

const ALIASES: Record<string, string> = { h: 'help', v: 'version', f: 'forward-to', e: 'events', k: 'api-key' }

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = []
  const options: Record<string, string | true> = {}

  for (let index = 0; index < argv.length; index++) {
    const word = argv[index]!
    if (word === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    const match = /^--?([a-z][a-z0-9-]*)(?:=(.*))?$/i.exec(word)
    if (!match) {
      positionals.push(word)
      continue
    }
    const name = ALIASES[match[1]!] ?? match[1]!
    if (match[2] !== undefined) {
      options[name] = match[2]
    } else if (BOOLEANS.has(name)) {
      options[name] = true
    } else {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new UsageError(`L'option --${name} attend une valeur.`)
      options[name] = value
      index++
    }
  }

  return { positionals, options }
}

/** La valeur d'une option texte, ou rien. Une option sans valeur là où il en faut une est une erreur. */
export function stringOption(args: Args, name: string): string | undefined {
  const value = args.options[name]
  if (value === true) throw new UsageError(`L'option --${name} attend une valeur.`)
  return value
}

/** `a,b c` devient `['a', 'b', 'c']`. */
export function listOption(args: Args, name: string): string[] {
  return (stringOption(args, name) ?? '')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
}
