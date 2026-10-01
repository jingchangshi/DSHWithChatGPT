/** Target replacement or document navigation invalidates prior semantic state. */
export interface BrowserTargetIdentity {
  targetId: string
  documentId: string
  url: string
  epoch: number
  /** Monotonic history cursor within this concrete binding/document generation. */
  transitionSequence: number
}

export class BrowserTargetChangedError extends Error {
  constructor() { super('BROWSER_TARGET_CHANGED: browser target or document changed'); this.name = 'BrowserTargetChangedError' }
}

/** Input was admitted but its document-bound outcome could not be proven. */
export class BrowserMutationUncertainError extends BrowserTargetChangedError {
  constructor() { super(); this.name = 'BrowserMutationUncertainError'; this.message = 'BROWSER_TARGET_CHANGED: mutation outcome uncertain; explicit rebind required' }
}

export function sameBrowserTarget(left: BrowserTargetIdentity, right: BrowserTargetIdentity): boolean {
  return left.targetId === right.targetId && left.documentId === right.documentId && left.epoch === right.epoch
}
