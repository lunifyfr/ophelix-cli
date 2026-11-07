import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '../../src/context'

export interface Recorded {
  context: Context
  out: string[]
  err: string[]
  controller: AbortController
  calls: Array<{ url: string; init?: RequestInit }>
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

/** Un contexte sans réseau ni attente : `fetch` répond par `handler`, la configuration vit dans un dossier jetable. */
export function recorded(handler: Handler, env: NodeJS.ProcessEnv = {}): Recorded {
  const out: string[] = []
  const err: string[] = []
  const calls: Recorded['calls'] = []
  const controller = new AbortController()
  const context: Context = {
    env: { OPHELIX_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), 'ophelix-cli-')), 'config'), ...env },
    out: line => out.push(line),
    err: line => err.push(line),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof fetch,
    sleep: async () => undefined,
    now: () => new Date('2026-11-07T10:00:00Z'),
    signal: controller.signal,
    color: false,
    openBrowser: () => false,
  }
  return { context, out, err, controller, calls }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Request-Id': 'req_test' } })
}
