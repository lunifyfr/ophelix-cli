import { afterAll, describe, expect, it } from 'bun:test'
import { statSync } from 'node:fs'
import { verifySignature } from '@ophelix/node'
import { run } from '../../src/cli'
import { configPath, readLogin, saveLogin } from '../../src/config'
import { forward, isLocalUrl, normalizeUrl, patternMatches } from '../../src/relay'
import { json, recorded } from './helpers'

const SECRET = 'whsec_relais'
const received: Array<{ body: string; signature: string }> = []
const local = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push({ body: await request.text(), signature: request.headers.get('Ophelix-Signature') ?? '' })
    return new Response('ok', { status: request.url.endsWith('/fail') ? 500 : 200 })
  },
})
afterAll(() => local.stop(true))

const feedPage = (events: Array<{ id: string; type: string }>, requests: unknown[] = []) => ({
  object: 'test_feed',
  events: events.map(event => ({ ...event, created: 1, body: JSON.stringify({ id: event.id, type: event.type }) })),
  requests,
  events_cursor: events.at(-1)?.id ?? 'evt_0',
  requests_cursor: 'req_0',
  signing_secret: SECRET,
  poll_interval: 2,
})

describe('le relais', () => {
  it('ne vise que ce poste', () => {
    expect(isLocalUrl('http://localhost:3000/hooks')).toBe(true)
    expect(isLocalUrl('http://app.localhost/hooks')).toBe(true)
    expect(isLocalUrl('http://127.0.0.1:3000')).toBe(true)
    expect(isLocalUrl('http://[::1]:3000')).toBe(true)
    expect(isLocalUrl('https://exemple.fr/hooks')).toBe(false)
    expect(isLocalUrl('http://user:pass@localhost/hooks')).toBe(false)
    expect(isLocalUrl('ftp://localhost')).toBe(false)
    expect(normalizeUrl('localhost:3000/hooks')).toBe('http://localhost:3000/hooks')
  })

  it('prend une famille, un type exact, ou tout', () => {
    expect(patternMatches([], 'claim.paid')).toBe(true)
    expect(patternMatches(['claim.*'], 'claim.paid')).toBe(true)
    expect(patternMatches(['claim.*'], 'batch.sent')).toBe(false)
    expect(patternMatches(['batch.sent'], 'batch.sent')).toBe(true)
    expect(patternMatches(['*'], 'card.inserted')).toBe(true)
  })

  it('livre le corps exact, signé comme une vraie livraison', async () => {
    const { context } = recorded(() => new Response())
    context.fetch = globalThis.fetch
    const body = '{"id":"evt_1","type":"claim.paid"}'

    const result = await forward(context, `http://localhost:${local.port}/hooks`, body, SECRET)

    expect(result.status).toBe(200)
    const last = received.at(-1)!
    expect(last.body).toBe(body)
    expect(() => verifySignature(last.body, last.signature, SECRET)).not.toThrow()
  })

  it('dit une connexion refusée sans s’arrêter', async () => {
    const { context } = recorded(() => new Response())
    context.fetch = globalThis.fetch
    const result = await forward(context, 'http://127.0.0.1:1/hooks', '{}', SECRET)
    expect(result).toMatchObject({ status: null, error: 'connexion impossible' })
  })
})

describe('ophelix listen', () => {
  it('relaie les événements choisis vers le serveur local, puis s’arrête sur ^C', async () => {
    let reads = 0
    const recording = recorded(
      (url, init) => {
        if (url.includes('/v1/test-helpers/feed')) {
          reads++
          if (reads === 1) return json(feedPage([]))
          if (reads === 2)
            return json(
              feedPage([
                { id: 'evt_1', type: 'claim.paid' },
                { id: 'evt_2', type: 'card.inserted' },
              ]),
            )
          recording.controller.abort()
          return json(feedPage([]))
        }
        return globalThis.fetch(url, init)
      },
      { OPHELIX_API_KEY: 'sk_test_abcd', OPHELIX_API_URL: 'http://api.test' },
    )
    const before = received.length

    const code = await run(['listen', '--forward-to', `localhost:${local.port}/hooks`, '--events', 'claim.*'], recording.context)

    expect(code).toBe(0)
    expect(recording.out[0]).toContain(SECRET)
    expect(recording.out.join('\n')).toContain('--> claim.paid [evt_1]')
    expect(recording.out.join('\n')).toContain('<-- [200]')
    expect(recording.out.join('\n')).not.toContain('card.inserted')
    expect(received.slice(before).map(item => JSON.parse(item.body).id)).toEqual(['evt_1'])
    expect(recording.calls[1]!.url).toContain('events_after=evt_0')
  })

  it('refuse un serveur distant', async () => {
    const recording = recorded(() => json({}), { OPHELIX_API_KEY: 'sk_test_abcd' })
    expect(await run(['listen', '--forward-to', 'https://exemple.fr/hooks'], recording.context)).toBe(2)
    expect(recording.calls).toEqual([])
  })

  it('donne le secret seul', async () => {
    const recording = recorded(() => json(feedPage([])), { OPHELIX_API_KEY: 'sk_test_abcd' })
    expect(await run(['listen', '--print-secret'], recording.context)).toBe(0)
    expect(recording.out).toEqual([SECRET])
  })

  it('s’arrête sur une clé refusée', async () => {
    const recording = recorded(
      () => json({ error: { type: 'authentication_error', code: 'invalid_api_key', message: 'Clé inconnue.' } }, 401),
      { OPHELIX_API_KEY: 'sk_test_abcd' },
    )
    expect(await run(['logs', 'tail'], recording.context)).toBe(1)
    expect(recording.err[0]).toContain('ophelix login')
  })
})

describe('ophelix logs tail', () => {
  it('affiche les requêtes, avec le code d’erreur, filtrées par statut', async () => {
    let reads = 0
    const request = (id: string, status: number, error_code: string | null) => ({
      id,
      method: 'POST',
      path: '/v1/claims',
      status,
      duration_ms: 12,
      error_code,
      api_key: 'key_1',
      created: 1_762_509_600,
    })
    const recording = recorded(
      () => {
        reads++
        if (reads === 2) return json(feedPage([], [request('req_1', 201, null), request('req_2', 400, 'parameter_missing')]))
        if (reads > 2) recording.controller.abort()
        return json(feedPage([]))
      },
      { OPHELIX_API_KEY: 'sk_test_abcd' },
    )

    expect(await run(['logs', 'tail', '--status', '4xx'], recording.context)).toBe(0)
    const output = recording.out.join('\n')
    expect(output).toContain('400  POST /v1/claims parameter_missing  [req_2] 12 ms')
    expect(output).not.toContain('req_1')
  })
})

describe('ophelix login', () => {
  it('relève la clé une fois le terminal autorisé, et la garde en 600', async () => {
    let polls = 0
    const recording = recorded(url => {
      if (url.endsWith('/cli/v1/logins')) {
        return json(
          {
            object: 'cli_login',
            device_code: 'cld_x',
            user_code: 'RB7K-4Q2M',
            verification_url: 'http://app.test/developers/cli?code=RB7K-4Q2M',
            expires_at: 0,
            interval: 2,
          },
          201,
        )
      }
      polls++
      return json(
        polls < 2
          ? { object: 'cli_login', status: 'pending' }
          : {
              object: 'cli_login',
              status: 'approved',
              secret: 'rk_test_relevee1234',
              api_key: 'key_1',
              livemode: false,
              expires_at: 2,
              organization: { id: 'org_1', name: 'Cabinet de test' },
            },
      )
    })

    expect(await run(['login', '--api-url', 'http://api.test', '--device-name', 'poste-de-jeff', '--no-browser'], recording.context)).toBe(
      0,
    )

    expect(JSON.parse(String(recording.calls[0]!.init?.body))).toEqual({ device_name: 'poste-de-jeff' })
    expect(recording.out[0]).toContain('RB7K-4Q2M')
    expect(recording.out.join('\n')).toContain('Connecté à Cabinet de test')
    expect(recording.out.join('\n')).not.toContain('rk_test_relevee1234')
    const stored = readLogin(recording.context.env)!
    expect(stored).toMatchObject({ key: 'rk_test_relevee1234', source: 'device', api_url: 'http://api.test', key_id: 'key_1' })
    expect(statSync(configPath(recording.context.env)).mode & 0o777).toBe(0o600)
  })

  it('dit un refus', async () => {
    const recording = recorded(url =>
      url.endsWith('/logins')
        ? json({ device_code: 'cld_x', user_code: 'A', verification_url: 'u', expires_at: 0, interval: 2 }, 201)
        : json({ status: 'denied' }),
    )
    expect(await run(['login', '--api-url', 'http://api.test', '--no-browser'], recording.context)).toBe(1)
    expect(recording.err[0]).toContain('refusée')
    expect(readLogin(recording.context.env)).toBeNull()
  })

  it('révoque à la déconnexion la clé relevée, et oublie une clé collée sans rien révoquer', async () => {
    const device = recorded(() => json({ object: 'cli_logout', revoked: true }))
    saveLogin({ api_url: 'http://api.test', key: 'rk_test_relevee', source: 'device', created_at: 1 }, device.context.env)
    expect(await run(['logout'], device.context)).toBe(0)
    expect(device.calls[0]!.url).toBe('http://api.test/cli/v1/logout')
    expect(new Headers(device.calls[0]!.init?.headers).get('Authorization')).toBe('Bearer rk_test_relevee')
    expect(readLogin(device.context.env)).toBeNull()

    const pasted = recorded(() => json({}))
    saveLogin({ api_url: 'http://api.test', key: 'sk_test_collee', source: 'pasted', created_at: 1 }, pasted.context.env)
    expect(await run(['logout'], pasted.context)).toBe(0)
    expect(pasted.calls).toEqual([])
    expect(readLogin(pasted.context.env)).toBeNull()
  })
})
