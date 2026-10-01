import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../src/browser')
describe('shared Web semantics boundary', () => {
  it('has one independent semantic driver and an explicit primitive/epoch contract', () => {
    for (const name of ['chatgpt-web-driver.ts', 'primitives.ts', 'epoch.ts']) {
      expect(existsSync(resolve(root, name)), `Missing canonical browser boundary: ${name}`).toBe(true)
    }
  })
  it('keeps composer, App and reply algorithms out of the compatibility transport', () => {
    const ast = ts.createSourceFile('harness.ts', readFileSync(resolve(root, 'harness.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
    const semanticMethods: string[] = []
    const forbidden = new Set(['activateAppMention', 'findAppCandidate', 'verifyAppMention', 'inspectChatPage', 'resolveComposer', 'clearComposer', 'typeComposerExpected', 'appSeparator'])
    function visit(node: ts.Node): void {
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && forbidden.has(node.name.text)) semanticMethods.push(node.name.text)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(semanticMethods).toEqual([])
  })
  it('does not let the semantic driver depend on concrete transport, Cordis or OS APIs', () => {
    const path = resolve(root, 'chatgpt-web-driver.ts')
    expect(existsSync(path), 'Canonical semantic driver must exist before dependency verification').toBe(true)
    const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const violations: string[] = []
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text
        if (/harness|cdp|@deepseek-ai|sidecar|^node:(fs|path|child_process|net|http|https)/i.test(name)) violations.push(name)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(violations).toEqual([])
  })
})
