export class ControlBrowserOwnership {
  private active = false

  async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.active) throw new Error('CONTROL_BROWSER_BUSY')
    this.active = true
    try {
      return await operation()
    } finally {
      this.active = false
    }
  }
}
