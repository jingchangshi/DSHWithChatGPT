import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
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
  it('has no transitive application, producer or host authority dependency', () => {
    const seen = new Set<string>()
    const failures: string[] = []
    function walk(path: string, chain: string[]) {
      if (seen.has(path)) return
      seen.add(path)
      const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function dependency(name: string) {
        const next = [...chain, name]
        if (/sidecar|@deepseek|cordis|chatgpt-web-driver|orchestrator|workspace|execution|protocol|child_process|^node:(fs|os|path|worker_threads)/i.test(name)) failures.push(next.join(' -> '))
        else if (name.startsWith('.')) walk(resolve(dirname(path), name.replace(/\.js$/, '.ts')), next)
        else if (!['ws', 'node:http', 'node:timers/promises'].includes(name)) failures.push(next.join(' -> '))
      }
      function visit(node: ts.Node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
          if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text)
          else failures.push([...chain, 'computed dependency'].join(' -> '))
        }
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text)
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    walk(resolve(browserRoot, 'direct-cdp.ts'), [])
    expect(failures).toEqual([])
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
