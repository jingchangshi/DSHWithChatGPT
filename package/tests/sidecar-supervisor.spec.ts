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
})
