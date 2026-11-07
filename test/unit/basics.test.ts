import { describe, expect, it } from 'bun:test'
import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs, UsageError } from '../../src/args'
import { run } from '../../src/cli'
import { hint } from '../../src/commands/login'
import { statusMatches } from '../../src/commands/logs'
import { today } from '../../src/commands/trigger'
import { configPath, forgetLogin, readLogin, saveLogin } from '../../src/config'
import { TRIGGERS } from '../../src/triggers'
import { recorded } from './helpers'

describe('la ligne de commande', () => {
  it('lit les mots, les options et leurs alias', () => {
    expect(parseArgs(['listen', '-f', 'localhost:3000/hooks', '--events=claim.*', '--print-secret'])).toEqual({
      positionals: ['listen'],
      options: { 'forward-to': 'localhost:3000/hooks', events: 'claim.*', 'print-secret': true },
    })
    expect(() => parseArgs(['listen', '--forward-to'])).toThrow(UsageError)
  })

  it('aide, version, commande inconnue', async () => {
    const help = recorded(() => new Response())
    expect(await run([], help.context)).toBe(0)
    expect(help.out.join('\n')).toContain('Usage : ophelix <commande>')

    const unknown = recorded(() => new Response())
    expect(await run(['deploy'], unknown.context)).toBe(2)
    expect(unknown.err[0]).toContain('Commande inconnue')
  })

  it('refuse une clé de production, sans appeler l’API', async () => {
    const live = recorded(() => new Response())
    expect(await run(['login', '--api-key', 'sk_live_abcd'], live.context)).toBe(2)
    expect(live.err[0]).toContain('clé de production')
    expect(live.calls).toEqual([])

    const trigger = recorded(() => new Response(), { OPHELIX_API_KEY: 'rk_live_abcd' })
    expect(await run(['trigger', 'claim.paid'], trigger.context)).toBe(2)
    expect(trigger.calls).toEqual([])
  })

  it('dit comment se connecter quand rien ne l’est', async () => {
    const none = recorded(() => new Response())
    expect(await run(['logs', 'tail'], none.context)).toBe(1)
    expect(none.err[0]).toContain('ophelix login')
  })

  it('ne montre jamais une clé entière', () => {
    expect(hint('sk_test_abcdefghijklmnop1234')).toBe('sk_test_…1234')
  })

  it('filtre les requêtes par code ou par famille', () => {
    expect(statusMatches(undefined, 200)).toBe(true)
    expect(statusMatches('4xx', 404)).toBe(true)
    expect(statusMatches('4xx', 500)).toBe(false)
    expect(statusMatches('404,5xx', 503)).toBe(true)
  })

  it('date les soins du jour du poste', () => {
    expect(today(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07')
  })

  it('déclenche chaque événement une seule fois', () => {
    const events = TRIGGERS.map(trigger => trigger.event)
    expect(new Set(events).size).toBe(events.length)
    expect(events).toContain('claim.paid')
  })
})

describe('la configuration', () => {
  it('se garde en 600 dans un dossier en 700, et s’oublie', () => {
    const { context } = recorded(() => new Response())
    const path = saveLogin({ api_url: 'http://localhost:8000', key: 'sk_test_x', source: 'pasted', created_at: 1 }, context.env)

    expect(path).toBe(configPath(context.env))
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
    expect(readLogin(context.env)?.key).toBe('sk_test_x')

    expect(forgetLogin(context.env)).toBe(true)
    expect(readLogin(context.env)).toBeNull()
  })

  it('suit XDG_CONFIG_HOME sans OPHELIX_CONFIG_DIR', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/ophelix/config.json')
  })
})
