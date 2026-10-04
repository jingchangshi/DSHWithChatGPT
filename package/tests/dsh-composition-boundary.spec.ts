import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

const sourceRoot = resolve(import.meta.dirname, '../src')

function dependencies(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const names: string[] = []
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) names.push(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) names.push(node.argument.literal.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) names.push(node.arguments[0].text)
      else names.push('<computed dependency>')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

describe('DSH inbound adapter and deployment boundary', () => {
  it('defaults to the primary Sidecar path and requires explicit compatibility selection', () => {
    expect(Config.parse({}).browserMode).toBe('sidecar')
    expect(Config.parse({ browserMode: 'browser-harness-mcp' }).browserMode).toBe('browser-harness-mcp')
  })
  it('accepts only an environment variable name for control-plane proxy configuration', () => {
    expect(Config.parse({}).tunnelControlPlaneHttpProxyEnv).toBe('CONTROL_PLANE_HTTP_PROXY')
    expect(Config.parse({ tunnelControlPlaneHttpProxyEnv: 'PRIVATE_TUNNEL_PROXY' }).tunnelControlPlaneHttpProxyEnv).toBe('PRIVATE_TUNNEL_PROXY')
    expect(() => Config.parse({ tunnelControlPlaneHttpProxyEnv: 'http://operator:password@proxy.invalid' })).toThrow()
    expect(() => Config.parse({ tunnelControlPlaneHttpProxyEnv: '' })).toThrow()
  })
  it('installs the primary path rather than silently overriding defaults in the bundle patch', () => {
    const patch = readFileSync(resolve(sourceRoot, '../cordis.patch.yml'), 'utf8')
    expect(patch).toMatch(/browserMode:\s+sidecar\s/)
    expect(patch).toMatch(/sidecarEndpoint:\s+http:\/\/127\.0\.0\.1:18765\s/)
    expect(patch).not.toContain('browser-harness-mcp')
  })
  it('keeps concrete runtime composition out of the package entry', () => {
    const entry = resolve(sourceRoot, 'index.ts')
    const forbidden = dependencies(entry).filter(name => /(?:browser|tunnel|bridge|execution|workspace|orchestrator|storage-domain|adapters\/cordis)/.test(name))
    expect(forbidden).toEqual([])
    expect(readFileSync(entry, 'utf8')).not.toMatch(/tools\/execute|tools\/result|tools\.register|systemPrompt\.section/)
  })

  it('keeps browser, exposure and concrete persistence authority out of the inbound DSH adapter transitively', () => {
    const failures: string[] = []
    const seen = new Set<string>()
    function walk(file: string, chain: string[]): void {
      if (seen.has(file)) return
      seen.add(file)
      for (const name of dependencies(file)) {
        const next = [...chain, name]
        if (/(?:browser|sidecar|tunnel|mcp-exposure|storage-domain|adapters\/cordis|deployment|<computed dependency>|node:(?:fs|child_process|http|net))/.test(name)) failures.push(next.join(' -> '))
        else if (name.startsWith('.')) walk(resolve(dirname(file), name.replace(/\.js$/, '.ts')), next)
      }
    }
    walk(resolve(sourceRoot, 'adapters/dsh/agent.ts'), ['DshAgentAdapter'])
    expect(failures).toEqual([])
  })

  it('accepts an explicit neutral Sidecar endpoint and protected credential reference for primary composition', () => {
    const configuration = Config.parse({
      browserMode: 'sidecar',
      sidecarEndpoint: 'http://127.0.0.1:18765',
      sidecarCredentialFile: resolve(sourceRoot, '../../../private-state/sidecar.secret'),
    })
    expect(configuration).toMatchObject({
      browserMode: 'sidecar',
      sidecarEndpoint: 'http://127.0.0.1:18765',
      sidecarCredentialFile: resolve(sourceRoot, '../../../private-state/sidecar.secret'),
    })
  })

  it('supports an explicit deployment-owned Sidecar process without making it a core concern', () => {
    expect(Config.parse({
      browserMode: 'sidecar',
      sidecarProcessCommand: 'chat-control-sidecar',
      sidecarProcessArgs: ['--config', 'sidecar.json'],
    })).toMatchObject({
      browserMode: 'sidecar',
      sidecarProcessCommand: 'chat-control-sidecar',
      sidecarProcessArgs: ['--config', 'sidecar.json'],
    })
  })
})
