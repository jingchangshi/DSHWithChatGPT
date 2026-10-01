// Released entry-point alias only. The canonical runner owns model selection,
// browser isolation, evidence checks and the acceptance/exit policy.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const env = { ...process.env }
env.DSH_CLI ??= env.C2C_DSH_CLI
env.MCP_EXPOSURE_CLIENT ??= env.C2C_TUNNEL_CLIENT
console.warn('Deprecated acceptance entry: use test:planner-executor-e2e; native Executor requires DEEPSEEK_API_KEY.')
const child = spawn(process.execPath, [fileURLToPath(new URL('./verify-planner-executor-e2e.mjs', import.meta.url)), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true })
child.once('error', () => { console.error('ACCEPTANCE_LAUNCH_FAILED'); process.exitCode = 1 })
child.once('close', code => { process.exitCode = code ?? 1 })