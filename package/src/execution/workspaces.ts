import path from 'node:path'
import { workspaceIdentity } from '../workspace/identity.ts'
import { ExecutionRecorder } from './recorder.ts'

/** Own one append-only execution log per canonical workspace identity. */
export class WorkspaceRecorders {
  private readonly recorders = new Map<string, ExecutionRecorder>()

  constructor(private readonly stateDir: string) {}

  forWorkspace(workspaceRoot: string): ExecutionRecorder {
    const workspaceId = workspaceIdentity(workspaceRoot)
    return this.forWorkspaceId(workspaceId)
  }

  /** Reuse evidence storage for an identity already resolved by the execution provider. */
  forWorkspaceId(workspaceId: string): ExecutionRecorder {
    let recorder = this.recorders.get(workspaceId)
    if (recorder === undefined) {
      recorder = new ExecutionRecorder({ stateDir: path.join(this.stateDir, 'executions', workspaceId) })
      this.recorders.set(workspaceId, recorder)
    }
    return recorder
  }
}
