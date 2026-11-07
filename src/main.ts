#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { run } from './cli'
import { type Context, sleep } from './context'

/** Ouvre une adresse dans le navigateur du poste, sans attendre. Rien ne s'ouvre hors d'un terminal. */
function openBrowser(url: string): boolean {
  if (!process.stdout.isTTY || process.env.CI) return false
  const [command, ...args] =
    process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url] : ['xdg-open', url]
  try {
    const child = spawn(command!, args, { stdio: 'ignore', detached: true })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
}

const controller = new AbortController()
let stopping = false
process.on('SIGINT', () => {
  // Un premier ^C laisse finir la livraison en cours, un second coupe tout.
  if (stopping) process.exit(130)
  stopping = true
  controller.abort()
})
process.on('SIGTERM', () => controller.abort())

const context: Context = {
  env: process.env,
  out: line => process.stdout.write(`${line}\n`),
  err: line => process.stderr.write(`${line}\n`),
  fetch: globalThis.fetch,
  sleep,
  now: () => new Date(),
  signal: controller.signal,
  color: process.stdout.isTTY === true && !process.env.NO_COLOR,
  openBrowser,
}

process.exitCode = await run(process.argv.slice(2), context)
