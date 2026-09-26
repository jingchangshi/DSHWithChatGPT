import type { McpToolDefinition } from './server.ts'

const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}),
})
const string = { type: 'string' }
const number = { type: 'number' }

/** Static MCP metadata shared by legacy tests and the provider-neutral bridge. */
export const WORKSPACE_TOOL_DEFINITIONS = {
  workspace_info: { name: 'workspace_info', description: 'Workspace identity and available read-only capabilities.', inputSchema: object({}) },
  list_directory: { name: 'list_directory', description: 'List a workspace-relative directory, excluding sensitive and noise entries; at most 500 entries.', inputSchema: object({ path: string }) },
  read_file: { name: 'read_file', description: 'Read a non-sensitive workspace-relative UTF-8 file up to 128 KiB.', inputSchema: object({ path: string }, ['path']) },
  search_workspace: { name: 'search_workspace', description: 'Search non-sensitive workspace files; at most 200 matches, skipping files over 512 KiB.', inputSchema: object({ query: string, is_regex: { type: 'boolean' }, subdirectory: string }, ['query']) },
  git_status: { name: 'git_status', description: 'Read Git HEAD, branch, and working-tree status.', inputSchema: object({}) },
  git_diff: { name: 'git_diff', description: 'Read a bounded working-tree diff against HEAD or a supplied ref.', inputSchema: object({ against_ref: string, max_bytes: number }) },
  git_log: { name: 'git_log', description: 'Read recent commit hashes and subjects; at most 50 commits.', inputSchema: object({ limit: number }) },
  test_status: { name: 'test_status', description: 'Read aggregate execution counts and latest test outcome, without command text or output.', inputSchema: object({ task_id: string }) },
  execution_summary: { name: 'execution_summary', description: 'Read aggregate execution outcomes filtered by task and iteration, without command text or output.', inputSchema: object({ task_id: string, iteration: number }) },
  execution_output: { name: 'execution_output', description: 'Read one recorded execution including capped and redacted output; requires content authorization.', inputSchema: object({ execution_id: string }, ['execution_id']) },
} satisfies Record<string, Omit<McpToolDefinition, 'handler'>>
