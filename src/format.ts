/** Mise en forme du terminal. Couleurs seulement vers un terminal, et jamais avec NO_COLOR. */

const CODES = { dim: [2, 22], bold: [1, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], cyan: [36, 39] } as const

export type Tone = keyof typeof CODES

export function paint(color: boolean, tone: Tone, text: string): string {
  const [open, close] = CODES[tone]
  return color ? `\u001b[${open}m${text}\u001b[${close}m` : text
}

/** L'heure locale du poste, à la seconde : ce qu'un développeur compare avec ses propres journaux. */
export function clock(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
}

export function statusTone(status: number | null): Tone {
  if (status === null || status >= 500) return 'red'
  if (status >= 400) return 'yellow'
  return 'green'
}
