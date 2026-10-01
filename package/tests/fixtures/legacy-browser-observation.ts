/** Extend legacy tool stubs with the mechanical document envelope, without changing
 * their simulated ChatGPT state or the assertions in their regression tests. */
export function legacyBrowserObservation(expression: string, value: unknown, url = 'https://chatgpt.com/'): unknown {
  if (expression.includes('document.activeElement === element')) value = true
  return expression.includes('__plannerbridgeDocumentIdentity')
    ? { value, token: 'stable-fixture-document', url, sequence: 0, transitions: [] }
    : value
}

/** Mechanical responses only; retains the original simulated semantic result. */
export function legacyBrowserMechanics(name: string, args: Record<string, unknown>, value: unknown, url = 'https://chatgpt.com/'): unknown {
  if (name.endsWith('browser_current_tab')) return { targetId: 'owned-target', url }
  return name.endsWith('browser_js') ? legacyBrowserObservation(String(args.expression), value, url) : value
}
