/** Stable browser failures shared by the semantic driver and transports. */
export class SendUncertainError extends Error {
  readonly code = 'SEND_UNCERTAIN'
  constructor() { super('SEND_UNCERTAIN'); this.name = 'SendUncertainError' }
}
export class ChatGptLoggedOutError extends Error {
  constructor() { super('ChatGPT_WEB_LOGGED_OUT: the browser session is not logged in to ChatGPT'); this.name = 'ChatGptLoggedOutError' }
}
export class ChatGptAppUnavailableError extends Error {
  constructor(appName: string, detail = 'no exact app mention candidate appeared') {
    super(`CHATGPT_APP_UNAVAILABLE: ${JSON.stringify(appName)}: ${detail}`)
    this.name = 'ChatGptAppUnavailableError'
  }
}
export class BrowserStaleError extends Error {
  constructor(detail: string) { super('BROWSER_STALE: ' + detail); this.name = 'BrowserStaleError' }
}

/** Definite page-command availability failure, distinct from transient DOM state. */
export class BrowserPageUnavailableError extends BrowserStaleError {
  constructor() { super('page command unavailable'); this.name = 'BrowserPageUnavailableError' }
}
