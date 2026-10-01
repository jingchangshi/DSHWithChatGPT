/** An opaque caller locator carries no execution authority by itself. */
export interface AgentExecution {
  name: string
  arguments: Record<string, unknown>
  sessionCwd?: string
  signal?: AbortSignal
  locator: unknown
}

export interface AgentTool {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false }
  output: { schema: unknown; render: unknown }
  execute(arguments_: Record<string, unknown>, execution: AgentExecution): Promise<unknown>
}

/** Evidence attribution and persistence remain owned by the injected runtime. */
export interface AgentEvidence<Owner> {
  freeze(execution: AgentExecution): Promise<Owner | undefined>
  record(execution: AgentExecution, result: unknown, owner: Owner): void
}

export interface AgentMount<Owner> {
  tools: AgentTool[]
  prompt?: { name: string; order: string; text: string }
  evidence?: AgentEvidence<Owner>
}
