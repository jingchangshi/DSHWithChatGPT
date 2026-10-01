import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { SidecarSupervisor } from '../src/deployment/sidecar-supervisor.ts'

describe('deployment Sidecar supervisor', () => {
  it('accepts only loopback semantic endpoints', () => {
    expect(() => new SidecarSupervisor({ command: process.execPath, endpoint: 'http://127.0.0.1:18765/', authentication: 'test' })).not.toThrow()
    expect(() => new SidecarSupervisor({ command: process.execPath, endpoint: 'http://0.0.0.0:18765/', authentication: 'test' })).toThrow()
    expect(() => new SidecarSupervisor({ command: process.execPath, endpoint: 'https://127.0.0.1:18765/', authentication: 'test' })).toThrow()
  })

  it('rejects an aborted start before spawning a process', async () => {
    const controller = new AbortController()
    controller.abort()
    const supervisor = new SidecarSupervisor({ command: process.execPath, endpoint: 'http://127.0.0.1:18765/', authentication: 'test' })
    await expect(supervisor.start(controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(supervisor.pid).toBeUndefined()
  })

  it('owns a separate semantic Sidecar process through startup and shutdown', async () => {
    const reservation = createServer().listen(0, '127.0.0.1')
    await new Promise<void>(resolve => reservation.once('listening', () => resolve()))
    const port = (reservation.address() as { port: number }).port
    await new Promise<void>(resolve => reservation.close(() => resolve()))
    const endpoint = `http://127.0.0.1:${port}/`
    const script = `
      const http = require('node:http');
      const server = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.headers.authorization !== 'Bearer integration-secret') { res.writeHead(401); return res.end(); }
        let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
          const request = JSON.parse(body);
          if (request.method !== 'health') { res.writeHead(400); return res.end(); }
          res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, detail: 'owned-test-sidecar' }));
        });
      });
      server.listen(${port}, '127.0.0.1');
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    const supervisor = new SidecarSupervisor({ command: process.execPath, args: ['-e', script], endpoint, authentication: 'integration-secret', startupTimeoutMs: 10_000 })
    await supervisor.start()
    const pid = supervisor.pid
    expect(pid).toEqual(expect.any(Number))
    await supervisor.close()
    expect(supervisor.pid).toBeUndefined()
    await supervisor.start()
    expect(supervisor.pid).toEqual(expect.any(Number))
    await supervisor.close()
    expect(supervisor.pid).toBeUndefined()
  })
})
