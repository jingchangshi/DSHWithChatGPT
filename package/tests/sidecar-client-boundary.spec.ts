import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('provider-neutral semantic Sidecar client', () => {
  it('has no transitive browser, producer, filesystem or platform dependencies', () => {
    const entry = resolve(import.meta.dirname, '../src/sidecar/index.ts')
    expect(existsSync(entry), 'Sidecar client must exist').toBe(true)
    const seen = new Set<string>()
    const failures: string[] = []
    function walk(path: string, chain: string[]): void {
      if (seen.has(path)) return
      seen.add(path)
      const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function dependency(name: string) {
        const next = [...chain, name]
        if (/browser|cdp|chrome|cordis|@deepseek|server|journal|^node:(fs|path|os|child_process|worker_threads)/i.test(name)) failures.push(next.join(' -> '))
        else if (name.startsWith('.')) { const target = resolve(dirname(path), name.replace(/\.js$/, '.ts')); if (existsSync(target)) walk(target, next) }
      }
      function visit(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text)
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text)
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text)
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    walk(entry, [])
    expect(failures).toEqual([])
  })
  it.each(['http://localhost:18765', 'http://0.0.0.0:18765', 'http://example.com:18765', 'https://127.0.0.1:18765', 'http://127.0.0.1:18765/?token=secret', 'http://user:secret@127.0.0.1:18765'])('rejects unsafe endpoint %s before network use', async endpoint => {
    const { SidecarChatControlClient } = await import('../src/sidecar/client.ts')
    expect(() => new SidecarChatControlClient({ endpoint, authentication: 'test-only-token' })).toThrow()
  })
})
