/**
 * dsh-with-chatgpt — persistent DeepSeek Harness plugin.
 *
 * ChatGPT thinks. DeepSeek Harness works.
 *
 * Host wiring: publishes the chatgptCoordinator service, registers the
 * five model-facing tools (chatgpt_plan / chatgpt_review / chatgpt_status /
 * chatgpt_reconnect / chatgpt_doctor), injects the collaboration section into the system
 * prompt, mounts the read-only MCP bridge, and persists task state through a
 * storage domain so tasks survive DSH restarts.
 * @module dsh-with-chatgpt
 */

import fs from 'node:fs'
import { join as joinPath } from 'node:path'
import { randomBytes, randomFillSync } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { DshAgentAdapter } from '../adapters/dsh/agent.ts'
import { roundIdentity } from '../adapters/dsh/round-identity.ts'
import type { AgentTool } from '../core/ports/agent.ts'
import { DshExecutionWorkspaceAdapter } from '../adapters/dsh/execution-workspace.ts'
import { DshGitAuthorityAdapter } from '../adapters/dsh/git-authority.ts'
import type { ExecutionWorkspacePort, WorkspaceAuthority } from '../core/ports/execution-workspace.ts'
import { taskProtocolVersion } from '../core/model.ts'
import { mintPlannerTaskId } from '../protocol/planner-envelope.ts'
import { plannerInstructions } from '../protocol/planner-instructions.ts'
import type { McpExposureProvider } from '../core/ports/mcp-exposure.ts'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { legacyStateDomain, CordisStateBackend } from '../adapters/cordis/state-store.ts'
import { plannerStateDomain, PlannerCordisStateBackend } from '../adapters/cordis/planner-state-store.ts'
import { ProtocolStateBackend } from '../orchestrator/protocol-state-backend.ts'
import { ChatGptCoordinator } from '../orchestrator/index.ts'
import { CHATGPT_BOOT_PROMPT } from '../protocol/legacy-planner-policy.ts'
import { CoordinatorState } from '../orchestrator/state.ts'
import { buildRuntimeWorkspaceTools } from '../bridge/tools.ts'
import { WorkspaceRuntimeRegistry } from '../workspace/runtime.ts'
import { reviewOutputScope } from '../execution/scope.ts'
import { ManagedTunnelOwnership } from '../orchestrator/ownership.ts'
import { ControlBrowserOwnership } from '../browser/ownership.ts'
import { mintTaskId } from '../protocol/index.ts'
import type { WorkspaceRuntimeIdentity } from '../workspace/runtime.ts'
import { resolveExecutionWorkspace } from '../workspace/execution-identity.ts'
import { startBridgeServer, type BridgeServer } from '../bridge/index.ts'
import { BrowserHarnessAdapter } from '../browser/index.ts'
import { gitStatus } from '../workspace/index.ts'
import { freezeShellExecution, observeShellResult, type FrozenExecutionContext, type ObservedExecution, type ObservedResult } from '../execution/observe.ts'
import { WorkspaceRecorders } from '../execution/workspaces.ts'
import { OpenAiSecureTunnelAdapter } from '../adapters/mcp-exposure/openai-secure-tunnel.ts'
import { throwIfCancelled } from '../cancellation.ts'
import { runDoctor, type AppProofWaitRecovery } from '../readiness/doctor.ts'
import { DeploymentSidecarControl } from './sidecar-control.ts'
import { validateSidecarEndpoint } from '../sidecar/protocol.ts'
import type { BrowserControl } from '../browser/adapter.ts'
import { SidecarRpcError } from '../sidecar/errors.ts'
import { SidecarSupervisor } from './sidecar-supervisor.ts'
import { createOwnedSidecarReplacement } from './sidecar-target-recovery.ts'
import { readSidecarCredential } from './sidecar-credential.ts'

// ---------------------------------------------------------------- config

export interface Config {
  /** Loopback port for the read-only MCP bridge (0 = ephemeral). */
  bridgePort: number
  /** Reply wait timeout for ChatGPT rounds, ms. */
  replyTimeoutMs: number
  /** Browser control plane flavor. */
  browserMode: 'sidecar' | 'browser-harness-mcp'
  sidecarEndpoint: string
  sidecarCredentialFile?: string
  /** Optional owned Sidecar executable; omitted means externally managed. */
  sidecarProcessCommand?: string
  sidecarProcessArgs?: string[]
  /** Exact ChatGPT custom-app name activated for every control message. */
  chatgptAppName: string
  /** Autonomous review/fix safety bound. */
  maxIterations: number
  /** Whether autonomous review uses the worktree or committed+pushed iterations. */
  gitPolicy: 'worktree' | 'commit-push'
  /** Explicit policy for fixed execution-workspace Git reads. */
  gitReadPolicy?: 'require-full' | 'allow-hardened-windows' | 'disabled'
  /** Legacy Git read grant, accepted only for compatibility. */
  gitRead?: boolean
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
  browserMode: z.enum(['sidecar', 'browser-harness-mcp']).default('sidecar'),
  sidecarEndpoint: z.string().refine(value => { try { validateSidecarEndpoint(value); return true } catch { return false } }, 'literal loopback Sidecar endpoint required').default('http://127.0.0.1:18765'),
  sidecarCredentialFile: z.string().optional(),
  sidecarProcessCommand: z.string().min(1).optional(),
  sidecarProcessArgs: z.array(z.string()).optional(),
  chatgptAppName: z.string().default('DSH with ChatGPT'),
  maxIterations: z.number().int().min(1).max(64).default(12),
  gitPolicy: z.enum(['worktree', 'commit-push']).default('worktree'),
  gitReadPolicy: z.enum(['require-full', 'allow-hardened-windows', 'disabled']).optional(),
  gitRead: z.boolean().optional(),
  protectedBranches: z.array(z.string()).default(['main', 'master']),
  tunnelMode: z.enum(['auto', 'managed', 'external']).default('auto'),
  tunnelId: z.string().optional(),
  tunnelClientPath: z.string().default('tunnel-client'),
  tunnelIdEnv: z.string().default('CONTROL_PLANE_TUNNEL_ID'),
  tunnelRuntimeApiKeyEnv: z.string().default('CONTROL_PLANE_API_KEY'),
  tunnelStartupTimeoutMs: z.number().int().min(1000).default(20_000),
}) as unknown as z.ZodType<Config>

export function resolveGitReadPolicy(config: Config): NonNullable<Config['gitReadPolicy']> {
  if (config.gitReadPolicy !== undefined && config.gitRead !== undefined) {
    const legacy = config.gitRead ? 'require-full' : 'disabled'
    if (legacy !== config.gitReadPolicy) throw new Error('gitRead and gitReadPolicy conflict')
  }
  return config.gitReadPolicy ?? (config.gitRead === true ? 'require-full' : 'disabled')
}

// ---------------------------------------------------------------- state

const controlDomain = defineDomain({
  name: 'd2c_control', version: 1,
  tables: {
    managed_tunnel: domainTable(z.object({
      workspaceId: z.string(), taskId: z.string(), claimId: z.string(),
      phase: z.enum(['pre-task', 'task']), createdAt: z.number(), updatedAt: z.number(),
    })),
  },
})

// ---------------------------------------------------------------- apply


export const name = 'dsh-with-chatgpt'

/** Required services for durable collaboration in the mounted execution world. */
export const inject = ['tools', 'systemPrompt', 'storageDomain', 'executionWorldIdentity', 'fs', 'subprocess', 'sandbox']

/** Activate only after durable storage opens; Cordis awaits tool registration. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const gitReadPolicy = resolveGitReadPolicy(config)
  // Canonical tasks have a frozen pushed-HEAD contract. The configurable
  // worktree policy remains applicable only to explicit legacy task dispatch.
  const primaryGitPolicy = config.browserMode === 'sidecar' ? 'commit-push' : config.gitPolicy
  const activate = async (): Promise<void> => {
    const storageDomain = ctx.get('storageDomain')
    if (storageDomain === undefined) throw new Error('DURABLE_STORAGE_UNAVAILABLE')
    const domain = await storageDomain.open(legacyStateDomain)
    ctx.effect(() => () => domain.close(), 'dsh-with-chatgpt durable state')
    const plannerDomain = await storageDomain.open(plannerStateDomain)
    ctx.effect(() => () => plannerDomain.close(), 'PlannerBridge durable state')
    const coordinatorState = new CoordinatorState(new ProtocolStateBackend(
      new CordisStateBackend(domain), new PlannerCordisStateBackend(plannerDomain),
    ))
    const control = await storageDomain.open(controlDomain)
    ctx.effect(() => () => control.close(), 'dsh-with-chatgpt control state')
    const ownership = new ManagedTunnelOwnership({
      get: async () => control.table('managed_tunnel').get('owner'),
      put: async owner => { await control.table('managed_tunnel').put('owner', owner) },
      delete: async () => { await control.table('managed_tunnel').delete('owner') },
    }, coordinatorState)
    const browserOwnership = new ControlBrowserOwnership()

    // ---- execution recorder lives in DSH storage area (outside workspaces)
    const stateDir = joinStateDir()
    const recorders = new WorkspaceRecorders(stateDir)
    const workspaceRuntimes = new WorkspaceRuntimeRegistry()
    const exposureAdapter = new OpenAiSecureTunnelAdapter({
      mode: config.tunnelMode,
      clientPath: config.tunnelClientPath,
      ...(config.tunnelId !== undefined ? { configuredTunnelId: config.tunnelId } : {}),
      tunnelIdEnv: config.tunnelIdEnv,
      runtimeApiKeyEnv: config.tunnelRuntimeApiKeyEnv,
      startupTimeoutMs: config.tunnelStartupTimeoutMs,
      stateDir,
    })

    const exposure: McpExposureProvider = exposureAdapter

    // ---- browser control
    // Browser Harness tools are session-gated, so every model-facing tool call
    // gets a coordinator bound to the CURRENT DSH agent/session.
    const sidecarControls = new Map<string, DeploymentSidecarControl>()
    const sidecarSupervisors = new Map<string, { supervisor: SidecarSupervisor; targetId?: string; cdpEndpoint?: string }>()
    const replacementAttempts = new Map<string, string>()
    const makeBrowser = (agent: unknown, workspace: WorkspaceRuntimeIdentity): BrowserControl => {
      if (config.browserMode === 'browser-harness-mcp') return new BrowserHarnessAdapter(ctx, agent as never, config.chatgptAppName)
      const key = workspace.workspaceId + '\0' + workspace.displayRoot
      const existing = sidecarControls.get(key)
      if (existing) return existing
      const control = new DeploymentSidecarControl({
        endpoint: config.sidecarEndpoint,
        credentialFile: config.sidecarCredentialFile ?? joinPath(privateStateBase(), 'PlannerBridge', 'credentials', 'authentication.secret'),
        excludedRoots: [workspace.displayRoot],
      })
      sidecarControls.set(key, control)
      return control
    }

    // ---- bridge + Secure MCP Tunnel runtime
    const bridges = new Map<string, BridgeServer>()
    const bridgeTokens = new Map<string, { subject: string; workspaceId: string }>()

    async function ensureBridge(workspace: WorkspaceRuntimeIdentity): Promise<{
      port: number
      token: string
      configPath: string
      tokenFile: string
      localUrl: string
      workspaceId: string
    }> {
      const { workspaceId } = workspace
      const configPath = joinPath(stateDir, 'connectors', workspaceId + '.json')
      const tokenFile = joinPath(stateDir, 'connectors', workspaceId + '.bearer')
      const existing = bridges.get(workspaceId)
      if (existing !== undefined) {
        const token = [...bridgeTokens.entries()].find(([, v]) => v.workspaceId === workspaceId)?.[0]
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

      const token = 'pb_auth_' + randomToken(32)
      const server = await startBridgeServer(
        { port: config.bridgePort, tokens: new Map([[token, 'workspace:' + workspaceId]]) },
        buildRuntimeWorkspaceTools({ workspaceId, registry: workspaceRuntimes, recorder: recorders.forWorkspaceId(workspaceId) }),
      )
      bridges.set(workspaceId, server)
      bridgeTokens.set(token, { subject: 'workspace:' + workspaceId, workspaceId })
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

    async function ensureRuntime(workspace: WorkspaceRuntimeIdentity, signal?: AbortSignal) {
      throwIfCancelled(signal)
      if (config.browserMode === 'sidecar') {
        if (config.sidecarProcessCommand !== undefined) {
          const key = workspace.workspaceId + '\0' + workspace.displayRoot
          if (!sidecarSupervisors.has(key)) {
            const credentialFile = config.sidecarCredentialFile ?? joinPath(privateStateBase(), 'PlannerBridge', 'credentials', 'authentication.secret')
            const authentication = await readSidecarCredential(credentialFile, [workspace.displayRoot])
            const supervisor = new SidecarSupervisor({ command: config.sidecarProcessCommand, args: config.sidecarProcessArgs, endpoint: config.sidecarEndpoint, authentication, startupTimeoutMs: config.tunnelStartupTimeoutMs })
            await supervisor.start(signal)
            sidecarSupervisors.set(key, { supervisor, targetId: process.env.PLANNERBRIDGE_SIDECAR_TARGET_ID, cdpEndpoint: process.env.PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT })
          }
        }
        const health = await makeBrowser(undefined, workspace).health()
        throwIfCancelled(signal)
        if (!health.ok) throw new SidecarRpcError('SIDECAR_UNAVAILABLE')
      }
      const start = async () => {
        const bridge = await ensureBridge(workspace)
        throwIfCancelled(signal)
        const exposureStatus = await exposure.ensure({
          workspaceId: bridge.workspaceId,
          loopbackEndpoint: bridge.localUrl,
          authorizationReference: bridge.tokenFile,
        }, signal)
        if (!exposureStatus.ready) throw new Error('MCP_EXPOSURE_NOT_READY')
        const tunnelStatus = exposureAdapter.compatibilityStatus(exposureStatus)
        return { bridge, tunnelStatus }
      }
      return exposureAdapter.effectiveMode() === 'managed' ? ownership.withWorkspace(workspace.workspaceId, start) : start()
    }

    // ---- coordinator
    function coordinatorFor(workspace: WorkspaceRuntimeIdentity, exec?: ToolExec): ChatGptCoordinator {
      return new ChatGptCoordinator({
        plannerInstructions: config.browserMode === 'sidecar' ? plannerInstructions(config.chatgptAppName) : CHATGPT_BOOT_PROMPT,
        canonicalProtocol: config.browserMode === 'sidecar',
        ...(exec?.workspacePort && exec.authority ? { gitAuthority: new DshGitAuthorityAdapter({
          workspace: exec.workspacePort, registry: workspaceRuntimes, locator: exec,
          workspaceId: workspace.workspaceId, authority: exec.authority,
        }) } : {}),
        browser: makeBrowser(exec?.agent, workspace),
        store: coordinatorState,
        workspaceRoot: workspace.displayRoot,
        workspaceId: workspace.workspaceId,
        replyTimeoutMs: config.replyTimeoutMs,
        maxIterations: config.maxIterations,
      })
    }

    // ---- execution evidence: observe the real DSH shell tool pipeline.
    // ChatGPT's test_status/execution_summary must be backed by actual tool
    // outcomes, not by the executor's prose claims.
    // ---- model-facing tools
    const agentTools: AgentTool[] = []
    const registerTool = (definition: {
      name: string
      description: string
      parameters: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false }
      output: { schema: unknown; render: unknown }
      execute(args: Record<string, unknown>, exec: ToolExec | undefined, workspace: WorkspaceRuntimeIdentity): Promise<unknown>
    }): void => {
      agentTools.push({
        ...definition,
        async execute(args, invocation) {
          const exec = invocation.locator as ToolExec | undefined
          const operation = async () => {
            if (definition.name === 'chatgpt_doctor' && args.mode !== undefined && args.mode !== 'local' && args.mode !== 'app-proof') throw new Error('INVALID_DOCTOR_MODE')
            const workspacePort: ExecutionWorkspacePort = new DshExecutionWorkspaceAdapter({
              context: ctx, registry: workspaceRuntimes, gitReadPolicy,
              resolve: (_locator, signal) => workspaceOf(ctx, { ...exec, signal }),
              ...(definition.name === 'chatgpt_review' ? {
                authorizeOutput: workspace => reviewOutputScope(coordinatorState, workspace.workspaceId, String(args.taskId)),
              } : {}),
              ...(definition.name === 'chatgpt_doctor' && args.mode === 'app-proof' ? {
                createAppProofChallenge: () => randomBytes(32).toString('hex'),
              } : {}),
            })
            return workspacePort.withOperation({
              locator: exec,
              capabilities: definition.name === 'chatgpt_plan' || definition.name === 'chatgpt_review'
                ? ['workspaceContentRead', 'gitRead'] : [],
            }, authority => definition.execute(args, { ...exec, signal: authority.signal, authority, workspacePort }, authority.identity), exec?.signal)
          }
          return definition.name === 'chatgpt_status' ? operation() : browserOwnership.run(operation)
        },
      })
    }

    /** Shared output schema (raw JSON Schema subset) for the plan/review payload shape. */
    const roundOutputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Planner task id.' },
        state: { type: 'string', description: 'Task state after this round.' },
        iteration: { type: 'integer', description: 'Protocol iteration.' },
        protocolVersion: { type: 'integer', description: 'Validated task protocol version: canonical 2 or legacy 1.' },
        workspaceId: { type: 'string', description: 'Workspace identity from the validated reviewer envelope.' },
        head: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'HEAD from the validated reviewer envelope; null for an initial plan.' },
        actions: { type: 'string', description: 'ACTIONS section from the ChatGPT envelope.' },
        successCriteria: { type: 'string', description: 'SUCCESS_CRITERIA section (plan rounds).' },
        rationale: { type: 'string', description: 'RATIONALE section (plan rounds).' },
        summary: { type: 'string', description: 'SUMMARY section (review rounds).' },
      },
      required: ['taskId', 'state', 'iteration', 'protocolVersion', 'workspaceId', 'head'],
    } as const

    /** Render a round payload as compact model-facing text. */
    function renderRound(_args: Record<string, unknown>, value: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
      const lines: string[] = []
      lines.push('taskId: ' + String(value['taskId']))
      lines.push('state: ' + String(value['state']))
      lines.push('iteration: ' + String(value['iteration']))
      lines.push('workspaceId: ' + String(value['workspaceId']))
      if (typeof value['head'] === 'string') lines.push('head: ' + value['head'])
      for (const key of ['actions', 'successCriteria', 'rationale', 'summary'] as const) {
        const text = value[key]
        if (typeof text === 'string' && text.length > 0) lines.push(key + ':\\n' + text)
      }
      return [{ type: 'text', text: lines.join('\\n') }]
    }

    registerTool({
      name: 'chatgpt_plan',
      description:
        'Start a ChatGPT collaboration round: send the task goal to ChatGPT Web (planning brain) and wait for its '
        + 'structured PLAN envelope. ChatGPT reads the workspace itself via the read-only MCP connector; do not paste '
        + 'files or diffs into the conversation. Returns the parsed plan sections for you to execute.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { goal: { type: 'string', description: 'The concrete task goal, phrased for a planning reviewer.' } },
        required: ['goal'],
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined, workspace: WorkspaceRuntimeIdentity) {
        const coordinator = coordinatorFor(workspace, exec)
        workspaceRuntimes.require(workspace.workspaceId, 'workspaceContentRead')
        workspaceRuntimes.require(workspace.workspaceId, 'gitRead')
        // Bridge + tunnel must be ready before INIT so ChatGPT can immediately
        // verify workspace_info for the exact workspace id.
        const taskId = config.browserMode === 'sidecar' ? mintPlannerTaskId() : mintTaskId()
        const owner = exposureAdapter.effectiveMode() === 'managed' ? await ownership.reserve(workspace.workspaceId, taskId) : undefined
        try {
          await ensureRuntime(workspace, exec?.signal)
          const started = config.browserMode === 'sidecar'
            ? await coordinator.startCanonicalTask(taskId, String(args.goal), { signal: exec?.signal })
            : await coordinator.startTask(taskId, String(args.goal), { signal: exec?.signal })
          if (owner !== undefined) await ownership.promote(owner)
          const round = await coordinator.awaitPlan(started.taskId, exec?.signal)
          return {
            taskId: round.taskId,
            state: round.record.state,
            iteration: round.record.iteration,
            protocolVersion: taskProtocolVersion(round.record),
            ...roundIdentity(round.envelope),
            actions: round.envelope.sections.get('ACTIONS') ?? '',
            successCriteria: round.envelope.sections.get('SUCCESS_CRITERIA') ?? '',
            rationale: round.envelope.sections.get('RATIONALE') ?? '',
          }
        } finally {
          if (owner !== undefined) await ownership.settle(owner)
        }
      },
    })

    registerTool({
      name: 'chatgpt_review',
      description:
        'After you implemented the plan and ran tests, report execution to ChatGPT and request independent review. '
        + 'ChatGPT reads the diff and execution records itself via MCP. Returns DONE or a fix plan (PLAN state).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          taskId: { type: 'string', description: 'Task id from chatgpt_plan.' },
          changedFiles: { type: 'array', items: { type: 'string' }, description: 'Array of changed file paths (workspace-relative).' },
          head: { type: 'string', description: 'Current git HEAD sha after your work.' },
          testsRecorded: { type: 'boolean', description: 'Whether test runs were recorded (execute tests through normal DSH tools).' },
          note: { type: 'string', description: 'Short execution note (max ~200 chars).' },
        },
        required: ['taskId'],
      },
      output: {
        schema: roundOutputSchema,
        render: renderRound as never,
      },
      async execute(args: Record<string, unknown>, exec: ToolExec | undefined, workspace: WorkspaceRuntimeIdentity) {
        workspaceRuntimes.require(workspace.workspaceId, 'workspaceContentRead')
        workspaceRuntimes.require(workspace.workspaceId, 'gitRead')
        workspaceRuntimes.require(workspace.workspaceId, 'executionOutput')
        const owner = exposureAdapter.effectiveMode() === 'managed' ? await ownership.requireTaskOwner(workspace.workspaceId, String(args.taskId)) : undefined
        try {
          await ensureRuntime(workspace, exec?.signal)
          const task = await coordinatorState.loadTask(String(args.taskId))
          if ((task && taskProtocolVersion(task) === 2) || config.gitPolicy === 'commit-push') {
            const executor = workspaceRuntimes.require(workspace.workspaceId, 'gitRead').lease.git
            if (!executor) throw new Error('SUBPROCESS_CAPABILITY_UNAVAILABLE')
            const current = await gitStatus(executor)
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
          const coordinator = coordinatorFor(workspace, exec)
          const summary = {
            changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles.map(String) : [],
            head: typeof args.head === 'string' ? args.head : null,
            testsRecorded: args.testsRecorded === true,
            ...(args.note !== undefined ? { note: String(args.note).slice(0, 200) } : {}),
          }
          const round = task && taskProtocolVersion(task) === 2
            ? await coordinator.reportCanonicalExecuted(String(args.taskId), { ...summary, head: String(args.head ?? '') }, exec?.signal)
            : await coordinator.reportExecuted(String(args.taskId), summary, exec?.signal)
          return {
            taskId: round.taskId,
            state: round.record.state,
            iteration: round.record.iteration,
            protocolVersion: taskProtocolVersion(round.record),
            ...roundIdentity(round.envelope),
            summary: round.envelope.sections.get('SUMMARY') ?? '',
            actions: round.envelope.sections.get('ACTIONS') ?? '',
          }
        } finally {
          if (owner !== undefined) await ownership.settle(owner)
        }
      },
    })

    registerTool({
      name: 'chatgpt_status',
      description: 'Report dsh-with-chatgpt status: latest task, coordinator state, bridge ports, boot prompt id.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
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
            workspaceId: { type: 'string', description: 'Non-secret workspace identity echoed through control replies.' },
            chatgptAppName: { type: 'string', description: 'Exact app name auto-activated for every message.' },
            gitPolicy: { type: 'string', description: 'Autonomous git policy.' },
            gitReadPolicy: { type: 'string', description: 'Normalized policy for fixed Git reads.' },
            maxIterations: { type: 'integer', description: 'Autonomous review/fix round limit.' },
            tunnel: { description: 'Secure MCP Tunnel readiness summary.' },
            bootPromptVersion: { type: 'integer', description: 'Boot prompt version.' },
          },
          required: ['plugin', 'workspaceRoot', 'latestTask', 'bridgeRunning', 'bridgePort', 'connectorConfigPath', 'workspaceId', 'chatgptAppName', 'gitPolicy', 'gitReadPolicy', 'maxIterations', 'tunnel', 'bootPromptVersion'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: JSON.stringify(value),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined, workspaceRoot: WorkspaceRuntimeIdentity) {
        const coordinator = coordinatorFor(workspaceRoot, exec)
        const latestTaskId = await coordinator.latestTaskId()
        const task = latestTaskId !== undefined ? await coordinator.status(latestTaskId) : undefined
        const runtime = await ensureRuntime(workspaceRoot, exec?.signal)
        return {
          plugin: 'dsh-with-chatgpt',
          workspaceRoot: workspaceRoot.displayRoot,
          latestTask: task ?? null,
          bridgeRunning: true,
          bridgePort: runtime.bridge.port,
          connectorConfigPath: runtime.bridge.configPath,
          workspaceId: runtime.bridge.workspaceId,
          chatgptAppName: config.chatgptAppName,
          gitPolicy: primaryGitPolicy,
          gitReadPolicy,
          maxIterations: config.maxIterations,
          tunnel: runtime.tunnelStatus,
          bootPromptVersion: 2,
        }
      },
    })

    registerTool({
      name: 'chatgpt_reconnect',
      description: 'Recover the ChatGPT control plane after browser reload, logout, or DSH restart; rebinding the latest task.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            recovered: { type: 'boolean', description: 'Whether a prior task was found and rebound.' },
            workspaceId: { type: 'string', description: 'Resolved workspace identity for this recovery.' },
            task: { description: 'Recovered task record, or null.' },
            detail: { type: 'string', description: 'Human-readable recovery detail.' },
          },
          required: ['recovered', 'task', 'detail', 'workspaceId'],
        },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{
          type: 'text' as const,
          text: String(value['detail']),
        }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined, workspaceRoot: WorkspaceRuntimeIdentity) {
        const coordinator = coordinatorFor(workspaceRoot, exec)
        if (exposureAdapter.effectiveMode() === 'managed') {
          // Runtime setup is workspace-fenced before entering the serialized
          // recovery callback; it must not recursively acquire ownership.
          if (await ownership.hasPendingBootstrap(workspaceRoot.workspaceId)) {
            const key = workspaceRoot.workspaceId + '\0' + workspaceRoot.displayRoot
            const bootstrap = await (async () => {
                const recover = () => ownership.recoverPendingBootstrap(workspaceRoot.workspaceId,
                  () => coordinator.recover(exec?.signal), exec?.signal)
                try {
                  await ensureRuntime(workspaceRoot, exec?.signal)
                  return await recover()
                } catch (error) {
                  throwIfCancelled(exec?.signal)
                  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
                  const owned = sidecarSupervisors.get(key)
                  const taskId = await coordinator.latestTaskId()
                  if (!['BROWSER_TARGET_CHANGED', 'SIDECAR_UNAVAILABLE'].includes(String(code))
                    || config.browserMode !== 'sidecar' || !config.sidecarProcessCommand || !owned?.targetId || !owned.cdpEndpoint
                    || !taskId || replacementAttempts.get(key) === taskId
                    || !await ownership.hasPendingBootstrap(workspaceRoot.workspaceId)) throw error
                  // One deployment replacement per pending task. This is never a
                  // send retry: the unchanged coordinator proves the journal digest.
                  replacementAttempts.set(key, taskId)
                  const replacement = await createOwnedSidecarReplacement(owned.cdpEndpoint, owned.targetId, exec?.signal)
                  let supervisor: SidecarSupervisor | undefined
                  try {
                    await owned.supervisor.close()
                    throwIfCancelled(exec?.signal)
                    const authentication = await readSidecarCredential(config.sidecarCredentialFile
                      ?? joinPath(privateStateBase(), 'PlannerBridge', 'credentials', 'authentication.secret'), [workspaceRoot.displayRoot])
                    supervisor = new SidecarSupervisor({ command: config.sidecarProcessCommand, args: config.sidecarProcessArgs,
                      endpoint: config.sidecarEndpoint, authentication, startupTimeoutMs: config.tunnelStartupTimeoutMs,
                      env: { PLANNERBRIDGE_SIDECAR_TARGET_ID: replacement.replacementTargetId } })
                    await supervisor.start(exec?.signal)
                    const health = await makeBrowser(undefined, workspaceRoot).health()
                    throwIfCancelled(exec?.signal)
                    if (!health.ok) throw new SidecarRpcError('SIDECAR_UNAVAILABLE')
                    const recovered = await recover()
                    if (!recovered) throw new SidecarRpcError('SEND_UNCERTAIN')
                    sidecarSupervisors.set(key, { supervisor, targetId: replacement.replacementTargetId, cdpEndpoint: owned.cdpEndpoint })
                    await replacement.retireSource().catch(() => {})
                    return recovered
                  } catch (recoveryError) {
                    await supervisor?.close().catch(() => {})
                    await replacement.closeReplacement().catch(() => {})
                    throw recoveryError
                  }
                }
            })()
            if (bootstrap !== undefined) {
              return { recovered: true, task: bootstrap, workspaceId: workspaceRoot.workspaceId, detail: 'bootstrap rebound from exact outgoing-message proof; task ownership restored' }
            }
          }
          if (await ownership.reconnect(workspaceRoot.workspaceId) === 'cleared') {
            return { recovered: false, task: null, workspaceId: workspaceRoot.workspaceId, detail: 'orphaned pre-task reservation cleared; no task was persisted' }
          }
          const taskId = await coordinator.latestTaskId()
          const previous = taskId === undefined ? undefined : await coordinatorState.loadTask(taskId)
          if (previous !== undefined && !['done', 'blocked', 'error'].includes(previous.state)) {
            await ownership.requireTaskOwner(workspaceRoot.workspaceId, previous.taskId)
          }
        }
        await ensureRuntime(workspaceRoot, exec?.signal)
        const task = await coordinator.recover(exec?.signal)
        return {
          recovered: task !== undefined,
          workspaceId: workspaceRoot.workspaceId,
          task: task ?? null,
          detail: task !== undefined ? 'conversation rebound; task state intact' : 'no prior task for this workspace',
        }
      },
    })

    registerTool({
      name: 'chatgpt_doctor',
      description: 'Run bounded, read-only readiness checks for the current DSH Session and ChatGPT control plane.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { mode: { type: 'string', enum: ['local', 'app-proof'], description: 'Local checks by default; app-proof also sends a diagnostic message to the configured ChatGPT App.' } },
        required: [],
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ready: { type: 'boolean' }, localReady: { type: 'boolean' }, appDataPlaneVerified: { type: 'boolean' }, fullC2CVerified: { type: 'boolean' }, checks: { type: 'array' } }, required: ['ready', 'localReady', 'appDataPlaneVerified', 'fullC2CVerified', 'checks'] },
        render: (_args: Record<string, unknown>, value: Record<string, unknown>) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(_args: Record<string, unknown>, exec: ToolExec | undefined, workspaceRoot: WorkspaceRuntimeIdentity) {
        const runtime = await ensureRuntime(workspaceRoot, exec?.signal)
        const key = workspaceRoot.workspaceId + '\0' + workspaceRoot.displayRoot
        const attempts = new Set<string>() // Invocation-local: never survives as resend authority.
        return runDoctor({
          mode: _args.mode === 'app-proof' ? 'app-proof' : 'local',
          appProofTimeoutMs: Math.min(config.replyTimeoutMs, 90_000),
          workspaceRoot: workspaceRoot.displayRoot,
          workspaceId: runtime.bridge.workspaceId,
          appName: config.chatgptAppName,
          browser: makeBrowser(exec?.agent, workspaceRoot),
          runtime: { bridge: runtime.bridge, tunnel: runtime.tunnelStatus },
          bridgeHttp: { port: runtime.bridge.port, token: runtime.bridge.token },
          probeApp: signal => makeBrowser(exec?.agent, workspaceRoot).probeApp?.(config.chatgptAppName, signal) ?? Promise.reject(new Error('browser app probe unavailable')),
          ...(config.browserMode === 'sidecar' && config.sidecarProcessCommand ? {
            recoverAppProof: (operation: AppProofWaitRecovery, resume: () => Promise<string | undefined>, signal?: AbortSignal) => recoverOwnedAppProof({
              workspaceKey: key, attempts, owned: sidecarSupervisors.get(key),
              command: config.sidecarProcessCommand!, args: config.sidecarProcessArgs, endpoint: config.sidecarEndpoint,
              credentialFile: config.sidecarCredentialFile ?? joinPath(privateStateBase(), 'PlannerBridge', 'credentials', 'authentication.secret'),
              excludedRoots: [workspaceRoot.displayRoot], startupTimeoutMs: config.tunnelStartupTimeoutMs,
              health: () => makeBrowser(exec?.agent, workspaceRoot).health(),
              commit: owned => { sidecarSupervisors.set(key, owned) },
            }, operation, resume, signal),
          } : {}),
          signal: exec?.signal,
        })
      },
    })

    // ---- system prompt section
    new DshAgentAdapter(ctx).mount<FrozenExecutionContext>({
      tools: agentTools,
      evidence: {
        freeze: invocation => freezeShellExecution(invocation.locator as ObservedExecution, coordinatorState, execution => workspaceOf(ctx, execution)),
        record: (invocation, result, owner) => observeShellResult(invocation.locator as ObservedExecution,
          result as ObservedResult, owner, recorders.forWorkspaceId(owner.workspaceId)),
      },
      prompt: {
        name: 'dsh-with-chatgpt:collaboration',
        order: 'TOOL_WORKFLOW',
        text: [
          'dsh-with-chatgpt present: when the user asks to collaborate with ChatGPT, run the collaboration loop autonomously.',
          '- Use chatgpt_plan first. ChatGPT owns WHAT/WHY; you own HOW and all edits/shell/tests/git.',
          '- Never paste source, diffs, or logs into ChatGPT; it reads the exact workspace through the read-only MCP app.',
          '- Do not pause for user confirmation between PLAN, implementation, tests, and REVIEW. If review returns PLAN, implement the fix and review again until DONE.',
          '- Stop only on DONE, BLOCKED, max-iteration guard, authentication/CAPTCHA, infrastructure failure, unsafe conflict, or a product decision only the user can make.',
          '- Before every review run the relevant tests. Execution results are recorded automatically; investigate failures before review.',
          '- Current autonomous git policy: ' + primaryGitPolicy + '.',
          ...(primaryGitPolicy === 'commit-push' ? [
            '- In commit-push mode: never commit directly on protected branches ' + config.protectedBranches.join(', ') + '. Create/use a task branch (for example planner/<task-id>) before mutation when needed.',
            '- After each successful implementation round, commit the intended changes, push the current non-protected branch without force, obtain the exact HEAD, then call chatgpt_review.',
            '- A PLAN returned by review starts the next implementation/commit/push/review iteration automatically.',
          ] : [
            '- In worktree mode: review the current working-tree changes; do not invent commits/pushes unless the user asked for them.',
          ]),
          '- Never treat ChatGPT prose as a shell script; independently choose safe implementation commands.',
        ].join('\\n'),
      },
    })

    // ---- cleanup: register the async disposer with Cordis instead of
    // dropping it through Promise.then(). This closes bridge listeners and
    // the storage-domain handle when the plugin/profile unloads.
    ctx.effect(() => async () => {
      await exposure.close()
      await Promise.allSettled([...bridges.values()].map(bridge => bridge.close()))
      await Promise.allSettled([...sidecarSupervisors.values()].map(owned => owned.supervisor.close()))
      bridges.clear()
      sidecarSupervisors.clear()
      sidecarControls.clear()
    }, 'dsh-with-chatgpt runtime cleanup')
  }

  return activate()
}

/** @internal Deployment transaction used by the registered doctor. The supplied
 * closure resumes only the original wait and returns the unchanged proof check.
 * Exported from this module for native composition tests, not the package API. */
export async function recoverOwnedAppProof(options: {
  workspaceKey: string
  attempts: Set<string>
  owned?: { supervisor: SidecarSupervisor; targetId?: string; cdpEndpoint?: string }
  command: string
  args?: string[]
  endpoint: string
  credentialFile: string
  excludedRoots: string[]
  startupTimeoutMs: number
  health(): Promise<{ ok: boolean }>
  commit(owned: { supervisor: SidecarSupervisor; targetId: string; cdpEndpoint: string }): void
}, operation: AppProofWaitRecovery, resume: () => Promise<string | undefined>, signal?: AbortSignal): Promise<string | undefined> {
  throwIfCancelled(signal)
  const owned = options.owned
  const attempt = options.workspaceKey + '\0' + operation.sendOperationId
  const wait = operation.waitOperation
  if (!owned?.targetId || !owned.cdpEndpoint || !options.command || !wait.replyBaseline?.conversationId
    || wait.replyRecovery?.sendOperationId !== operation.sendOperationId || options.attempts.has(attempt)) throw new SidecarRpcError('BROWSER_STALE')
  options.attempts.add(attempt) // Before target creation, including uncertain creation outcomes.
  const replacement = await createOwnedSidecarReplacement(owned.cdpEndpoint, owned.targetId, signal)
  let supervisor: SidecarSupervisor | undefined
  let committed = false
  try {
    await owned.supervisor.close()
    throwIfCancelled(signal)
    const authentication = await readSidecarCredential(options.credentialFile, options.excludedRoots)
    supervisor = new SidecarSupervisor({ command: options.command, args: options.args,
      endpoint: options.endpoint, authentication, startupTimeoutMs: options.startupTimeoutMs,
      env: { PLANNERBRIDGE_SIDECAR_TARGET_ID: replacement.replacementTargetId } })
    await supervisor.start(signal)
    // Refresh the existing client's generation; never send on this transaction.
    if (!(await options.health()).ok) throw new SidecarRpcError('SIDECAR_UNAVAILABLE')
    throwIfCancelled(signal)
    const proofFailure = await resume()
    throwIfCancelled(signal)
    if (proofFailure !== undefined) return proofFailure
    options.commit({ supervisor, targetId: replacement.replacementTargetId, cdpEndpoint: owned.cdpEndpoint })
    committed = true
    await replacement.retireSource().catch(() => {})
    return undefined
  } finally {
    if (!committed) {
      await supervisor?.close().catch(() => {})
      await replacement.closeReplacement().catch(() => {})
    }
  }
}

/** Minimal tool execution context shape used by this plugin. */
type ToolExec = { agent?: { session?: { header?: { cwd?: string } } }; signal?: AbortSignal; authority?: WorkspaceAuthority; workspacePort?: ExecutionWorkspacePort }

/** Workspace root for a tool execution (session cwd). */
function workspaceOf(ctx: Context, exec: ToolExec | undefined): Promise<WorkspaceRuntimeIdentity> {
  return resolveExecutionWorkspace(ctx.get('executionWorldIdentity'), exec?.agent?.session?.header?.cwd, exec?.signal)
}

/** State dir under the OS config home (never inside a workspace). */
function joinStateDir(): string {
  // Preserve the documented legacy state location until explicit migration.
  return joinPath(privateStateBase(), 'dsh-with-chatgpt')
}

function privateStateBase(): string {
  const base = process.env['LOCALAPPDATA'] ?? process.env['XDG_STATE_HOME'] ?? process.env['HOME']
  if (!base) throw new Error('PRIVATE_STATE_BASE_UNAVAILABLE')
  return base
}

/** Random hex token. */
function randomToken(bytes: number): string {
  const array = new Uint8Array(bytes)
  randomFillSync(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}
