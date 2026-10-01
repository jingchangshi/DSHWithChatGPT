/** Extend legacy tool stubs with the mechanical document envelope, without changing
 * their simulated ChatGPT state or the assertions in their regression tests. */
export function legacyBrowserObservation(expression: string, value: unknown, url = 'https://chatgpt.com/'): unknown {
  return expression.includes('__plannerbridgeDocumentIdentity')
    ? { value, token: 'stable-fixture-document', url }
    : value
}
