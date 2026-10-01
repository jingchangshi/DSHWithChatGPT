/** PlannerBridge DSH plugin entry; concrete ownership belongs to deployment. */
export { apply, Config, inject, name, resolveGitReadPolicy } from './deployment/dsh-runtime.ts'
export { SidecarSupervisor, type SidecarSupervisorOptions } from './deployment/sidecar-supervisor.ts'
