/** Target replacement or document navigation invalidates prior semantic state. */
export interface BrowserTargetIdentity {
  targetId: string
  url: string
  epoch: number
}

export class BrowserTargetChangedError extends Error {
  constructor() { super('BROWSER_TARGET_CHANGED: browser target or document changed'); this.name = 'BrowserTargetChangedError' }
}

export function sameBrowserTarget(left: BrowserTargetIdentity, right: BrowserTargetIdentity): boolean {
  return left.targetId === right.targetId && left.url === right.url && left.epoch === right.epoch
}
