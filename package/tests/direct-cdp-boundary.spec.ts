import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDECAR_METHODS } from '../src/sidecar/protocol.ts'

const browserRoot = resolve(import.meta.dirname, '../src/browser')
describe('primary Direct CDP boundary', () => {
  it('provides the canonical primary primitive implementation', () => {
    expect(existsSync(resolve(browserRoot, 'direct-cdp.ts'))).toBe(true)
    expect(existsSync(resolve(browserRoot, 'cdp-session.ts'))).toBe(true)
  })
  it('keeps browser mechanics separate from Web policy and product authority', () => {
    const source = readFileSync(resolve(browserRoot, 'direct-cdp.ts'), 'utf8')
    expect(source).toMatch(/implements BrowserPrimitives/)
    expect(source).not.toMatch(/prompt-textarea|data-message-author-role|activateAppMention|verifyAppMention|inspectChatPage/)
    expect(source).not.toMatch(/from ['"].*(?:sidecar|@deepseek-ai|orchestrator|workspace|execution|protocol|child_process)/)
    expect(readFileSync(resolve(browserRoot, 'chatgpt-web-driver.ts'), 'utf8')).not.toMatch(/from ['"].*direct-cdp/)
  })
  it('retains the narrow Sidecar semantic RPC allowlist', () => {
    expect(SIDECAR_METHODS).not.toEqual(expect.arrayContaining(['evaluate']))
    for (const forbidden of ['cdp', 'evaluate', 'navigate', 'browser_js', 'shell', 'filesystem', 'git']) {
      expect(SIDECAR_METHODS).not.toContain(forbidden)
    }
  })
  it('puts focus mechanics and mutation fencing in the primitive contract', () => {
    const source = readFileSync(resolve(browserRoot, 'primitives.ts'), 'utf8')
    expect(source).toMatch(/focus\(/)
    expect(source).toMatch(/expected\??: BrowserTargetIdentity/)
    expect(readFileSync(resolve(browserRoot, 'epoch.ts'), 'utf8')).toMatch(/documentId: string/)
  })
})
