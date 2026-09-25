/**
 * dsh-with-chatgpt — persistent DeepSeek Harness plugin.
 *
 * ChatGPT thinks. DeepSeek Harness works.
 *
 * Host wiring: publishes the chatgptCoordinator service, registers the
 * four model-facing tools (chatgpt_plan / chatgpt_review / chatgpt_status /
 * chatgpt_reconnect), injects the collaboration section into the system
 * prompt, mounts the read-only MCP bridge, and persists task state through a
 * storage domain so tasks survive DSH restarts.
 * @module dsh-with-chatgpt
 */

import fs from 'node:fs'
import { join as joinPath } from 'node:path'
import { randomFillSync } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ChatGptCoordinator } from './orchestrator/index.ts'
import { CoordinatorState, type PersistedTask, type TaskState } from './orchestrator/state.ts'
import type { StateStore } from './orchestrator/state.ts'
import { loadWorkspaceSpec, buildWorkspaceTools } from './bridge/index.ts'
import { startBridgeServer, type BridgeServer } from './bridge/index.ts'
import { BrowserHarnessAdapter } from './browser/index.ts'
import { gitStatus, sessionWorkspaceRoot, workspaceIdentity } from './workspace/index.ts'
import { freezeShellExecution, observeShellResult, type FrozenExecutionContext, type ObservedExecution, type ObservedResult } from './execution/observe.ts'
import { WorkspaceRecorders } from './execution/workspaces.ts'
import { TunnelSupervisor } from './tunnel/index.ts'
import { throwIfCancelled } from './cancellation.ts'
import { runDoctor } from './readiness/doctor.ts'

// ---------------------------------------------------------------- config

export interface Config {
  /** Loopback port for the read-only MCP bridge (0 = ephemeral). */
  bridgePort: number
  /** Reply wait timeout for ChatGPT rounds, ms. */
  replyTimeoutMs: number
  /** Browser control plane flavor. */
  browserMode: 'browser-harness-mcp'
  /** Exact ChatGPT custom-app name activated for every D2C message. */
  chatgptAppName: string
  /** Autonomous review/fix safety bound. */
  maxIterations: number
  /** Whether autonomous C2C reviews the worktree or committed+pushed iterations. */
  gitPolicy: 'worktree' | 'commit-push'
  /** Branches the autonomous commit/push policy must never use directly. */
  protectedBranches: string[]
  /** Secure MCP Tunnel lifecycle policy. */
  tunnelMode: 'auto' | 'managed' | 'external'
  /** Optional tunnel id; otherwise tunnelIdEnv is read. */
  tunnelId?: string
  /** tunnel-client executable path. */
  tunnelClientPath: string
  /** Environment variable containing the tunnel id. */
  tunnelIdEnv: string
  /** Environment variable containing the runtime API key. */
  tunnelRuntimeApiKeyEnv: string
  /** Deadline for tunnel-client readiness. */
  tunnelStartupTimeoutMs: number
}

/** Plugin config schema (zod; the host layer adapts it to its config surface). */
export const Config: z.ZodType<Config> = z.object({
  bridgePort: z.number().default(0),
  replyTimeoutMs: z.number().default(240_000),
  browserMode: z.enum(['browser-harness-mcp']).default('browser-harness-mcp'),
  chatgptAppName: z.string().default('DSH with ChatGPT'),
  maxIterations: z.number().int().min(1).max(64).default(12),
  gitPolicy: z.enum(['worktree', 'commit-push']).default('worktree'),
  protectedBranches: z.array(z.string()).default(['main', 'master']),
  tunnelMode: z.enum(['auto', 'managed', 'external']).default('auto'),
  tunnelId: z.string().optional(),
  tunnelClientPath: z.string().default('tunnel-client'),
  tunnelIdEnv: z.string().default('CONTROL_PLANE_TUNNEL_ID'),
  tunnelRuntimeApiKeyEnv: z.string().default('CONTROL_PLANE_API_KEY'),
  tunnelStartupTimeoutMs: z.number().int().min(1000).default(20_000),
}) as unknown as z.ZodType<Config>

// ---------------------------------------------------------------- state

const taskRecordSchema = z.object({
  taskId: z.string(),
  goal: z.string(),
  state: z.enum(['awaiting-plan', 'planned', 'executing', 'executed', 'awaiting-review', 'done', 'blocked', 'error']),
  iteration: z.number(),
  waitingFor: z.enum(['none', 'chatgpt-plan', 'chatgpt-review', 'dsh-execution', 'user']),
  conversationId: z.string().nullable(),
  lastReviewedHead: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastError: z.string().nullable(),
})

const bindingSchema = z.object({
  workspaceRoot: z.string(),
  conversationId: z.string().nullable(),
  lastTaskId: z.string().nullable(),
  updatedAt: z.number(),
})

const indexSchema = z.object({ ids: z.array(z.string()) })

const d2cDomain = defineDomain({
  name: 'd2c_state',
  version: 1,
  tables: {
    tasks: domainTable(taskRecordSchema),
    bindings: domainTable(bindingSchema),
    index: domainTable(indexSchema),
  },
})

type D2cDomain = Domain<typeof d2cDomain>

/** StateStore backed by the Cordis storage domain (durable across restarts). */
class DomainStateStore implements StateStore {
  constructor(private readonly domain: D2cDomain) {}

  async get<T>(key: string): Promise<T | undefined> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') return this.domain.table('tasks').get(recordKey) as T | undefined
    if (table === 'workspace') return this.domain.table('bindings').get(recordKey) as T | undefined
    if (table === 'index') return this.domain.table('index').get(recordKey) as T | undefined
    return undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') await this.domain.table('tasks').put(recordKey, value as PersistedTask)
    else if (table === 'workspace') await this.domain.table('bindings').put(recordKey, value as never)
    else if (table === 'index') await this.domain.table('index').put(recordKey, value as never)
  }

  async delete(key: string): Promise<void> {
    const [table, ...rest] = key.split(':')
    const recordKey = rest.join(':')
    if (table === 'task') await this.domain.table('tasks').delete(recordKey)
    else if (table === 'workspace') await this.domain.table('bindings').delete(recordKey)
    else if (table === 'index') await this.domain.table('index').delete(recordKey)
  }
}

/** Memory fallback until (or without) the storage domain. */
const memoryCoordinatorState = new CoordinatorState(((): StateStore => {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> { return map.get(key) as T | undefined },
    async put<T>(key: string, value: T): Promise<void> { map.set(key, value) },
    async delete(key: string): Promise<void> { map.delete(key) },
  }
})())

// ---------------------------------------------------------------- apply


export const name = 'dsh-with-chatgpt'

/** Services this plugin hard-requires (storage-domain is optional in v1). */
export const inject: string[] = []

export function apply(ctx: Context, config: Config): void | Promise<void> {
  const activate = async (): Promise<void> => {
    // ---- state: durable storage domain when available
    let coordinatorState = memoryCoordinatorState
    let domain: Domain<typeof d2cDomain> | undefined
    const storageDomain = ctx.get('storageDomain')
    if (storageDomain !== undefined) {
      domain = await storageDomain.open(d2cDomain)
      coordinatorState = new CoordinatorState(new DomainStateStore(domain))
    }

    // ---- execution recorder lives in DSH storage area (outside workspaces)
    const stateDir = joinStateDir()
    const recorders = new WorkspaceRecorders(stateDir)
    const activeTasks = new Map<string, { taskId: string; iteration: number }>()
    const tunnel = new TunnelSupervisor({
      mode: config.tunnelMode,
      clientPath: config.tunnelClientPath,
      ...(config.tunnelId !== undefined ? { configuredTunnelId: config.tunnelId } : {}),
      tunnelIdEnv: config.tunnelIdEnv,
      runtimeApiKeyEnv: config.tunnelRuntimeApiKeyEnv,
      startupTimeoutMs: config.tunnelStartupTimeoutMs,
      stateDir,
    })

    // ---- browser control
    // Browser Harness tools are session-gated, so every model-facing tool call
    // gets a coordinator bound to the CURRENT DSH agent/session.
    const makeBrowser = (agent: unknown) => new BrowserHarnessAdapter(ctx, agent as never, config.chatgptAppName)

    // ---- bridge + Secure MCP Tunnel runtime
    const bridges = new Map<string, BridgeServer>()
    const bridgeTokens = new Map<string, { subject: string; workspaceRoot: string }>()

    async function ensureBridge(workspaceRoot: string): Promise<{
      port: number
      token: string
      configPath: string
      tokenFile: string
      localUrl: string
      workspaceId: string
    }> {
      const workspaceId = workspaceIdentity(workspaceRoot)
      const configPath = joinPath(stateDir, 'connectors', workspaceId + '.json')
      const tokenFile = joinPath(stateDir, 'connectors', workspaceId + '.bearer')
      const existing = bridges.get(workspaceRoot)
      if (existing !== undefined) {
        const token = [...bridgeTokens.entries()].find(([, v]) => v.workspaceRoot === workspaceRoot)?.[0]
        if (token !== undefined) {
          writeBridgeFiles(configPath, tokenFile, existing.port, token, workspaceId)
          return {
            port: existing.port,
            token,
            configPath,
            tokenFile,
            localUrl: 'http://127.0.0.1:' + existing.port + '/mcp',
            workspaceId,
          }
        }
      }

      const token = 'd2c_' + randomToken(32)
      const server = await startBridgeServer(
        { port: config.bridgePort, tokens: new Map([[token, 'workspace:' + workspaceId]]) },
        buildWorkspaceTools(loadWorkspaceSpec(workspaceRoot, recorders.forWorkspace(workspaceRoot))),
      )
      bridges.set(workspaceRoot, server)
      bridgeTokens.set(token, { subject: 'workspace:' + workspaceId, workspaceRoot })
      writeBridgeFiles(configPath, tokenFile, server.port, token, workspaceId)
      return {
        port: server.port,
        token,
        configPath,
        tokenFile,
        localUrl: 'http://127.0.0.1:' + server.port + '/mcp',
        workspaceId,
      }
    }

    function writeBridgeFiles(
      configPath: string,
      tokenFile: string,
      port: number,
      token: string,
      workspaceId: string,
    ): void {
      fs.mkdirSync(joinPath(configPath, '..'), { recursive: true })
      fs.writeFileSync(tokenFile, 'Bearer ' + token + '\n', { encoding: 'utf8', mode: 0o600 })
      try { fs.chmodSync(tokenFile, 0o600) } catch {}
      fs.writeFileSync(configPath, JSON.stringify({
        transport: 'streamable-http',
        workspaceId,
        localUrl: 'http://127.0.0.1:' + port + '/mcp',
        authorization: { type: 'bearer-file', tokenFile },
        tunnel: {
          mode: config.tunnelMode,
          tunnelIdSource: config.tunnelId !== undefined ? 'config' : config.tunnelIdEnv,
          runtimeApiKeyEnv: config.tunnelRuntimeApiKeyEnv,
        },
      }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
      try { fs.chmodSync(configPath, 0o600) } catch {}
    }

    async function ensureRuntime(workspaceRoot: string, signal?: AbortSignal) {
      throwIfCancelled(signal)
      if (config.tunnelMode === 'managed') {
        const otherActive = [...activeTasks.entries()].find(([root]) => root !== workspaceRoot)
        if (otherActive !== undefined) {
          throw new Error(
            'TUNNEL_WORKSPACE_BUSY: managed tunnel is owned by another active C2C workspace/task '
            + otherActive[1].taskId,
          )
        }
      }
      const bridge = await ensureBridge(workspaceRoot)
      throwIfCancelled(signal)
      const tunnelStatus = await tunnel.ensure({
        workspaceId: bridge.workspaceId,
        localUrl: bridge.localUrl,
        bearerValueFile: bridge.tokenFile,
      }, signal)
      return { bridge, tunnelStatus }
    }

    // ---- coordinator
    function coordinatorFor(workspaceRoot: string, agent: unknown): ChatGptCoordinator {
      return new ChatGptCoordinator({
        browser: makeBrowser(agent),
        store: coordinatorState,
        workspaceRoot,
        workspaceId: workspaceIdentity(workspaceRoot),
        replyTimeoutMs: config.replyTimeoutMs,
        maxIterations: config.maxIterations,
      })
    }

    // ---- execution evidence: observe the real DSH shell tool pipeline.
    // ChatGPT's test_status/execution_summary must be backed by actual tool
    // outcomes, not by the executor's prose claims.
    const ownership = new WeakMap<object, FrozenExecutionContext>()
    const toolEvents = ctx as unknown as {
      on(event: 'tools/execute', handler: (exec: ObservedExecution, next: () => Promise<ObservedResult>) => Promise<ObservedResult>): void
      on(event: 'tools/result', handler: (exec: ObservedExecution, result: ObservedResult) => void): void
    }
    toolEvents.on('tools/execute', async (exec, next) => {
      try {
        const owner = await freezeShellExecution(exec, coordinatorState)
        if (owner !== undefined) ownership.set(exec as object, owner)
      } catch (_observationFailure) {
      }
      return next()
    })
    toolEvents.on('tools/result', (exec, result) => {
      try {
        const owner = ownership.get(exec as object)
        if (owner === undefined) return
        ownership.delete(exec as object)
        observeShellResult(exec, result, owner, recorders.forWorkspace(owner.workspaceRoot))
      } catch (_recordingFailure) {
        return
      }
    })

    // ---- model-facing tools
    const tools = ctx.get('tools')
    if (tools === undefined) throw new Error('dsh-with-chatgpt requires the tools service')

    /** Shared output schema (raw JSON Schema subset) for the plan/review payload shape. */
    const roundOutputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'D2C task id.' },
        state: { type: 'string', description: 'Task state after this round.' },
        iteration: { type: 'integer', description: 'Protocol iteration.' },
        actions: { type: 'string', description: 'ACTIONS section from the ChatGPT envelope.' },
        successCriteria: { type: 'string', description: 'SUCCESS_CRITERIA section (plan rounds).' },
        rationale: { type: 'string', description: 'RATIONALE section (plan rounds).' },
        summary: { type: 'string', description: 'SUMMARY section (review rounds).' },
      },
      required: ['taskId', 'state', 'iteration'],
    } as const

    /** Render a round payload as compact model-facing text. */
    function renderRound(_args: Record<string, unknown>, value: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
      const lines: string[] = []
      lines.push('taskId: ' + String(value['taskId']))
      lines.push('state: ' + String(value['state']))
      lines.push('iteration: ' + String(value['iteration']))
      for (const key of ['actions', 'successCriteria', 'rationale', 'summary'] as const) {
        const text = value[key]
        if (typeof text === 'string' && text.length > 0) lines.push(key + ':\n' + text)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }

    tools.register({
      name: 'chatgpt_plan',
      description:
        'Start a ChatGPT collaboration round: send the task goal to ChatGPT Web (planning brain) and wait for its '
        + 'structured PLAN envelope. ChatGPT reads the workspace itself via the read-only MCP connector; do not paste '
        + 'files or diffs into the conversation. Returns the parsed plan sections for you to execute.',
      parameters: {
        goal: { type: 'string', required: true, description: 'The concrete task goal, phrased for a planning reviewer.' },
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        // Bridge + tunnel must be ready before INIT so ChatGPT can immediately
        // verify workspace_info for the exact workspace id.
        await ensureRuntime(workspaceRoot, exec?.signal)
        const started = await coordinator.startTask(String(args.goal), { signal: exec?.signal })
        const round = await coordinator.awaitPlan(started.taskId, exec?.signal)
        activeTasks.set(workspaceRoot, { taskId: round.taskId, iteration: round.record.iteration })
        return {
          taskId: round.taskId,
          state: round.record.state,
          iteration: round.record.iteration,
          actions: round.envelope.sections.get('ACTIONS') ?? '',
          successCriteria: round.envelope.sections.get('SUCCESS_CRITERIA') ?? '',
          rationale: round.envelope.sections.get('RATIONALE') ?? '',
        }
      },
    })

    tools.register({
      name: 'chatgpt_review',
      description:
        'After you implemented the plan and ran tests, report execution to ChatGPT and request independent review. '
        + 'ChatGPT reads the diff and execution records itself via MCP. Returns DONE or a fix plan (PLAN state).',
      parameters: {
        taskId: { type: 'string', required: true, description: 'Task id from chatgpt_plan.' },
        changedFiles: { type: 'json', description: 'Array of changed file paths (workspace-relative).' },
        head: { type: 'string', description: 'Current git HEAD sha after your work.' },
        testsRecorded: { type: 'boolean', description: 'Whether test runs were recorded (execute tests through normal DSH tools).' },
        note: { type: 'string', description: 'Short execution note (max ~200 chars).' },
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        await ensureRuntime(workspaceRoot, exec?.signal)
        if (config.gitPolicy === 'commit-push') {
          const current = await gitStatus(workspaceRoot)
          if (!current.isRepo || current.head === null || current.branch === null) {
            throw new Error('AUTONOMOUS_GIT_POLICY: commit-push mode requires a normal checked-out git branch with at least one commit')
          }
          if (config.protectedBranches.includes(current.branch)) {
            throw new Error('AUTONOMOUS_GIT_POLICY: refusing review on protected branch ' + current.branch)
          }
          if (current.dirty) {
            throw new Error('AUTONOMOUS_GIT_POLICY: commit-push mode requires a clean committed worktree before review')
          }
          if (current.upstream === null || current.upstreamHead === null) {
            throw new Error('AUTONOMOUS_GIT_POLICY: current task branch has no upstream; push it with upstream tracking before review')
          }
          if (current.ahead !== 0 || current.upstreamHead !== current.head) {
            throw new Error('AUTONOMOUS_GIT_POLICY: current HEAD is not fully pushed to upstream')
          }
          if (typeof args.head !== 'string' || args.head === '') {
            throw new Error('AUTONOMOUS_GIT_POLICY: commit-push mode requires the exact committed HEAD')
          }
          if (current.head !== args.head) {
            throw new Error('AUTONOMOUS_GIT_POLICY: supplied HEAD does not match current git HEAD')
          }
        }
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const round = await coordinator.reportExecuted(String(args.taskId), {
          changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles.map(String) : [],
          head: typeof args.head === 'string' ? args.head : null,
          testsRecorded: args.testsRecorded === true,
          ...(args.note !== undefined ? { note: String(args.note).slice(0, 200) } : {}),
        }, exec?.signal)
        if (round.record.state === 'planned') {
          activeTasks.set(workspaceRoot, { taskId: round.taskId, iteration: round.record.iteration })
        } else {
          activeTasks.delete(workspaceRoot)
        }
        return {
          taskId: round.taskId,
          state: round.record.state,
          iteration: round.record.iteration,
          summary: round.envelope.sections.get('SUMMARY') ?? '',
          actions: round.envelope.sections.get('ACTIONS') ?? '',
        }
      },
    })

    tools.register({
      name: 'chatgpt_status',
      description: 'Report dsh-with-chatgpt status: latest task, coordinator state, bridge ports, boot prompt id.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string', description: 'Plugin name.' },
            workspaceRoot: { type: 'string', description: 'Workspace the status is for.' },
            latestTask: { description: 'Latest persisted task record, or null.' },
            bridgeRunning: { type: 'boolean', description: 'Whether the read-only MCP bridge is listening.' },
            bridgePort: { description: 'Loopback bridge port.' },
            connectorConfigPath: { type: 'string', description: 'Local runtime metadata path; bearer value stays in a separate 0600 file.' },
            workspaceId: { type: 'string', description: 'Non-secret workspace identity echoed through D2C.' },
            chatgptAppName: { type: 'string', description: 'Exact app name auto-activated for every message.' },
            gitPolicy: { type: 'string', description: 'Autonomous git policy.' },
            maxIterations: { type: 'integer', description: 'Autonomous review/fix round limit.' },
            tunnel: { description: 'Secure MCP Tunnel readiness summary.' },
            bootPromptVersion: { type: 'integer', description: 'Boot prompt version.' },
          },
          required: ['plugin', 'workspaceRoot', 'latestTask', 'bridgeRunning', 'bridgePort', 'connectorConfigPath', 'workspaceId', 'chatgptAppName', 'gitPolicy', 'maxIterations', 'tunnel', 'bootPromptVersion'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: JSON.stringify(value),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const latestTaskId = await coordinator.latestTaskId()
        const task = latestTaskId !== undefined ? await coordinator.status(latestTaskId) : undefined
        const runtime = await ensureRuntime(workspaceRoot, exec?.signal)
        return {
          plugin: 'dsh-with-chatgpt',
          workspaceRoot,
          latestTask: task ?? null,
          bridgeRunning: true,
          bridgePort: runtime.bridge.port,
          connectorConfigPath: runtime.bridge.configPath,
          workspaceId: runtime.bridge.workspaceId,
          chatgptAppName: config.chatgptAppName,
          gitPolicy: config.gitPolicy,
          maxIterations: config.maxIterations,
          tunnel: runtime.tunnelStatus,
          bootPromptVersion: 2,
        }
      },
    })

    tools.register({
      name: 'chatgpt_reconnect',
      description: 'Recover the ChatGPT control plane after browser reload, logout, or DSH restart; rebinding the latest task.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            recovered: { type: 'boolean', description: 'Whether a prior task was found and rebound.' },
            task: { description: 'Recovered task record, or null.' },
            detail: { type: 'string', description: 'Human-readable recovery detail.' },
          },
          required: ['recovered', 'task', 'detail'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: String(value['detail']),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        await ensureRuntime(workspaceRoot, exec?.signal)
        const coordinator = coordinatorFor(workspaceRoot, exec?.agent)
        const task = await coordinator.recover(exec?.signal)
        if (task !== undefined && ['planned', 'executing', 'executed', 'awaiting-review'].includes(task.state)) {
          activeTasks.set(workspaceRoot, { taskId: task.taskId, iteration: task.iteration })
        }
        return {
          recovered: task !== undefined,
          task: task ?? null,
          detail: task !== undefined ? 'conversation rebound; task state intact' : 'no prior task for this workspace',
        }
      },
    })

    tools.register({
      name: 'chatgpt_doctor',
      description: 'Run bounded, read-only readiness checks for the current DSH Session and ChatGPT control plane.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ready: { type: 'boolean' }, checks: { type: 'array' } }, required: ['ready', 'checks'] },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined) {
        const workspaceRoot = workspaceOf(exec)
        const runtime = await ensureRuntime(workspaceRoot, exec?.signal)
        return runDoctor({
          workspaceRoot,
          workspaceId: runtime.bridge.workspaceId,
          appName: config.chatgptAppName,
          browser: makeBrowser(exec?.agent),
          runtime: { bridge: runtime.bridge, tunnel: runtime.tunnelStatus },
          bridgeHttp: { port: runtime.bridge.port, token: runtime.bridge.token },
          probeApp: signal => makeBrowser(exec?.agent).probeApp?.(config.chatgptAppName, signal) ?? Promise.reject(new Error('browser app probe unavailable')),
          signal: exec?.signal,
        })
      },
    })

    // ---- system prompt section
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined && typeof systemPrompt.section === 'function' && typeof systemPrompt.getSectionOrder === 'function') {
      systemPrompt.section({
        name: 'dsh-with-chatgpt:collaboration',
        order: systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
        text: [
          'dsh-with-chatgpt present: when the user asks to collaborate with ChatGPT / C2C, run the collaboration loop autonomously.',
          '- Use chatgpt_plan first. ChatGPT owns WHAT/WHY; you own HOW and all edits/shell/tests/git.',
          '- Never paste source, diffs, or logs into ChatGPT; it reads the exact workspace through the read-only MCP app.',
          '- Do not pause for user confirmation between PLAN, implementation, tests, and REVIEW. If review returns PLAN, implement the fix and review again until DONE.',
          '- Stop only on DONE, BLOCKED, max-iteration guard, authentication/CAPTCHA, infrastructure failure, unsafe conflict, or a product decision only the user can make.',
          '- Before every review run the relevant tests. Execution results are recorded automatically; investigate failures before review.',
          '- Current autonomous git policy: ' + config.gitPolicy + '.',
          ...(config.gitPolicy === 'commit-push' ? [
            '- In commit-push mode: never commit directly on protected branches ' + config.protectedBranches.join(', ') + '. Create/use a task branch (for example d2c/<task-id>) before mutation when needed.',
            '- After each successful implementation round, commit the intended changes, push the current non-protected branch without force, obtain the exact HEAD, then call chatgpt_review.',
            '- A PLAN returned by review starts the next implementation/commit/push/review iteration automatically.',
          ] : [
            '- In worktree mode: review the current working-tree changes; do not invent commits/pushes unless the user asked for them.',
          ]),
          '- Never treat ChatGPT prose as a shell script; independently choose safe implementation commands.',
        ].join('\n'),
      })
    }

    // ---- cleanup: register the async disposer with Cordis instead of
    // dropping it through Promise.then(). This closes bridge listeners and
    // the storage-domain handle when the plugin/profile unloads.
    ctx.effect(() => async () => {
      await tunnel.close()
      await Promise.allSettled([...bridges.values()].map(bridge => bridge.close()))
      bridges.clear()
      if (domain !== undefined) await domain.close()
    }, 'dsh-with-chatgpt runtime cleanup')
  }

  return activate()
}

/** Minimal tool execution context shape used by this plugin. */
type ToolExec = { agent?: { session?: { header?: { cwd?: string } } }; signal?: AbortSignal }

/** Workspace root for a tool execution (session cwd). */
function workspaceOf(exec: { agent?: { session?: { header?: { cwd?: string } } } } | undefined): string {
  return sessionWorkspaceRoot(exec?.agent?.session?.header?.cwd)
}

/** State dir under the OS config home (never inside a workspace). */
function joinStateDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? process.env['XDG_STATE_HOME'] ?? process.env['HOME'] ?? process.cwd()
  return joinPath(String(base), 'dsh-with-chatgpt')
}

/** Random hex token. */
function randomToken(bytes: number): string {
  const array = new Uint8Array(bytes)
  randomFillSync(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}
