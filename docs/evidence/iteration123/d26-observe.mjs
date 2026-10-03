import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { appendFileSync, readFileSync } from 'node:fs'
import { Server } from 'node:http'
import { performance } from 'node:perf_hooks'
import { basename } from 'node:path'

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const ownStart = performance.now()
function record(event, details = {}) {
  appendFileSync(config.output, JSON.stringify({ case: config.case, at: Date.now(), pid: process.pid,
    elapsedMs: Math.round((performance.now() - ownStart) * 100) / 100, event, ...details }) + '\n')
}
const fixtureChild = process.env.PLANNERBRIDGE_TEST_STATE !== undefined
record('preload-loaded', { fixtureChild })
if (fixtureChild) {
  const listen = Server.prototype.listen
  Server.prototype.listen = function (...args) {
    record('listener-requested')
    this.once('listening', () => record('listener-created'))
    return Reflect.apply(listen, this, args)
  }
  process.once('exit', code => record('child-process-exit', { code }))
}

const fork = cp.fork
const states = new Map()
const ordinals = new Map()
let latestChild
cp.fork = function (...args) {
  const target = basename(String(args[0])) === 'fake-sidecar.mjs'
  const started = performance.now()
  if (target) record('fork-requested')
  const child = Reflect.apply(fork, this, args)
  if (!target) return child
  latestChild = child.pid
  const options = args.findLast(value => value && !Array.isArray(value) && typeof value === 'object')
  const state = options?.env?.PLANNERBRIDGE_TEST_STATE
  if (!states.has(state)) states.set(state, states.size + 1)
  const ordinal = (ordinals.get(state) ?? 0) + 1
  ordinals.set(state, ordinal)
  const base = { childPid: child.pid, fixtureState: states.get(state), ordinal }
  const elapsed = () => Math.round((performance.now() - started) * 100) / 100
  record('fork-returned', base)
  child.once('spawn', () => record('process-created', { ...base, spawnElapsedMs: elapsed() }))
  child.once('error', error => record('process-error', { ...base, errorCode: error.code ?? null }))
  child.once('exit', (code, signal) => record('process-exit', { ...base, code, signal, spawnElapsedMs: elapsed() }))
  child.on('message', value => {
    if (value?.event === 'ready') record('ready-observed', { ...base, spawnElapsedMs: elapsed() })
    if (value?.event === 'phase') record('delivery-phase', { ...base, phase: value.phase })
  })
  for (const stream of ['stdout', 'stderr']) child[stream]?.once('data', () => record('first-byte', { ...base, stream, spawnElapsedMs: elapsed() }))
  const kill = child.kill
  child.kill = function (...killArgs) {
    record('kill-requested', { ...base, spawnElapsedMs: elapsed() })
    return Reflect.apply(kill, this, killArgs)
  }
  return child
}
syncBuiltinESMExports()

// Observe the existing 5s fixture timer, retaining its registration, delay,
// callback context and arguments. Never schedule or extend a deadline.
const setTimeoutOriginal = globalThis.setTimeout
globalThis.setTimeout = function (callback, delay, ...args) {
  const observed = delay === 5000 && new Error().stack?.includes('sidecar-process.ts')
  if (!observed) return Reflect.apply(setTimeoutOriginal, this, [callback, delay, ...args])
  const childPid = latestChild
  record('startup-timer-registered', { childPid, delay })
  return Reflect.apply(setTimeoutOriginal, this, [function (...callbackArgs) {
    record('startup-timeout-fired', { childPid, delay })
    return Reflect.apply(callback, this, callbackArgs)
  }, delay, ...args])
}
