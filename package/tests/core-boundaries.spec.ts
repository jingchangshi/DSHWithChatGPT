import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(import.meta.dirname, '../src')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}
const sources = files(sourceRoot)
const label = (path: string) => relative(sourceRoot, path).replaceAll('\\', '/')
function imports(path: string): string[] {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal.text)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return found
}
const graph = new Map(sources.map(path => [path, imports(path)]))
function violations(root: string): string[] {
  const seen = new Set<string>()
  const failures: string[] = []
  function walk(path: string, chain: string[]): void {
    if (seen.has(path)) return
    seen.add(path)
    for (const specifier of graph.get(path) ?? []) {
      const nextChain = [...chain, specifier]
      if (!specifier.startsWith('.')) {
        if (/^@deepseek-ai\/|browser-harness|playwright|puppeteer|chrome-remote-interface|storage-domain|tunnel-client|^node:(fs|path|os|child_process|net|http|https|worker_threads)(\/|$)/i.test(specifier)) failures.push(nextChain.join(' → '))
        continue
      }
      const candidate = resolve(dirname(path), specifier.replace(/\.js$/, '.ts'))
      const target = graph.has(candidate) ? candidate : graph.has(candidate + '.ts') ? candidate + '.ts' : join(candidate, 'index.ts')
      if (!graph.has(target)) throw new Error(`Unresolved source import: ${path}: ${specifier}`)
      const name = label(target)
      const forbidden = /^(browser|tunnel|adapters)\//.test(name) || name === 'index.ts' || name === 'bridge/server.ts' || name === 'workspace/with-read-lease.ts'
      if (forbidden) failures.push([...chain, name].join(' → '))
      walk(target, [...chain, name])
    }
  }
  walk(root, [label(root)])
  return failures
}

describe('provider-neutral dependency boundaries', () => {
  it('rejects direct and transitive concrete dependencies from every core, orchestrator and protocol module', () => {
    const roots = sources.filter(path => /^(core|orchestrator|protocol)\//.test(label(path)))
    expect(roots.length).toBeGreaterThan(0)
    expect(roots.flatMap(violations)).toEqual([])
  })
  it('never selects the explicit test memory backend in production composition', () => {
    const violations = sources.filter(path => !label(path).startsWith('orchestrator/state'))
      .filter(path => /\bcreateMemoryStore\b/.test(readFileSync(path, 'utf8'))).map(label)
    expect(violations).toEqual([])
  })
  it('keeps browser primitives and copied producer mechanisms out of canonical core', () => {
    const violations = sources.filter(path => label(path).startsWith('core/'))
      .filter(path => /browser_js|browser_cdp|contenteditable|querySelector|bindExecutionReadLease|bindExecutionGitLease|process\.cwd\(/.test(readFileSync(path, 'utf8'))).map(label)
    expect(violations).toEqual([])
  })
})
