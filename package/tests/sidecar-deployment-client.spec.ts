import { afterEach, describe, expect, it, vi } from 'vitest'
import * as credentials from '../src/deployment/sidecar-credential.ts'
import { sidecarProcess } from './fixtures/sidecar-process.ts'

const children: Awaited<ReturnType<typeof sidecarProcess>>[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(children.splice(0).map(child => child.close())) })

describe('primary Sidecar deployment client', () => {
  it('uses the neutral HTTP client and validates a protected reference against the current workspace', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    const child = await sidecarProcess()
    children.push(child)
    const read = vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue(child.authentication)
    const control = new DeploymentSidecarControl({ endpoint: child.endpoint, credentialFile: '/private/authentication.secret', excludedRoots: ['/execution/world'] })
    expect(read).not.toHaveBeenCalled()
    expect((await control.health()).ok).toBe(true)
    expect(await control.openConversation('deployment-conversation')).toBe('deployment-conversation')
    expect(await control.currentConversation()).toBe('deployment-conversation')
    expect(read).toHaveBeenCalledExactlyOnceWith('/private/authentication.secret', ['/execution/world'])
  })
  it('does not fall back to another provider when credentials are missing', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    vi.spyOn(credentials, 'readSidecarCredential').mockRejectedValue(new credentials.SidecarCredentialError())
    const control = new DeploymentSidecarControl({ endpoint: 'http://127.0.0.1:18765', credentialFile: '/missing/secret', excludedRoots: [] })
    await expect(control.ensureReady()).rejects.toMatchObject({ code: 'SIDECAR_CREDENTIAL_UNAVAILABLE' })
  })
  it('rejects a remote endpoint before accessing credentials', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    const read = vi.spyOn(credentials, 'readSidecarCredential')
    expect(() => new DeploymentSidecarControl({ endpoint: 'http://example.com:18765', credentialFile: '/private/secret', excludedRoots: [] })).toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('returns a typed transport failure if the configured Sidecar is unavailable', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    const child = await sidecarProcess()
    children.push(child)
    await child.close()
    vi.spyOn(credentials, 'readSidecarCredential').mockResolvedValue(child.authentication)
    const control = new DeploymentSidecarControl({ endpoint: child.endpoint, credentialFile: '/private/secret', excludedRoots: [], requestTimeoutMs: 1000 })
    await expect(control.ensureReady()).rejects.toMatchObject({ code: 'SIDECAR_UNAVAILABLE' })
  })
  it('rejects pre-aborted operations before reading credentials', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    const read = vi.spyOn(credentials, 'readSidecarCredential')
    const control = new DeploymentSidecarControl({ endpoint: 'http://127.0.0.1:18765', credentialFile: '/private/secret', excludedRoots: [] })
    const controller = new AbortController()
    controller.abort()
    await expect(control.sendControlMessage('must not send', controller.signal)).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(read).not.toHaveBeenCalled()
  })
  it('rechecks cancellation after asynchronous credential verification before any send', async () => {
    const { DeploymentSidecarControl } = await import('../src/deployment/sidecar-control.ts')
    let supply!: (value: string) => void
    vi.spyOn(credentials, 'readSidecarCredential').mockReturnValue(new Promise(resolve => { supply = resolve }))
    const control = new DeploymentSidecarControl({ endpoint: 'http://127.0.0.1:18765', credentialFile: '/private/secret', excludedRoots: [] })
    const controller = new AbortController()
    const pending = control.sendControlMessage('must not send', controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    controller.abort()
    supply('x'.repeat(43))
    await rejection
  })
})
