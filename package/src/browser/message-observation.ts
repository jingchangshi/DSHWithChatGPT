/** Read-only browser expression shared by reply waiting and explicit reconciliation.
 * Unknown or ambiguous message structure returns null; it never guesses a body.
 * The same scan reports MISSING_BODY only for one empty, identified current
 * user shell with no body marker and no other user or structural contradiction.
 */
export const messageObservationScript = String.raw`
let messageObservationState = 'STRUCTURAL_AMBIGUITY';
const messageObservations = (() => {
  const visible = element => {
    if (!element.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    // Inline breaks carry a semantic newline even when their own rectangle has
    // zero area. Ancestor and CSS visibility checks above still apply.
    if (element.tagName === 'BR') return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const marker = '[data-message-author-role], [data-chatgpt-search-unit-key], [data-content-search-unit-key]';
  const candidates = Array.from(document.querySelectorAll(marker + ', [data-markdown-text-style="assistant-message"], [data-chatgpt-selection-message-id]')).filter(node => visible(node) && (!node.hasAttribute('data-chatgpt-selection-message-id') || node.matches('[data-message-author-role], [data-markdown-text-style="assistant-message"]') || node.querySelector('[data-message-author-role], [data-markdown-text-style="assistant-message"]')));
  if (candidates.length > 2048) return null;
  const roots = candidates.filter(node => !candidates.some(parent => parent !== node && parent.contains(node)));
  if (roots.length > 512) return null;
  const identities = new Set();
  const messages = [];
  let missingBodies = 0;
  const excluded = 'button, [role="button"], [role="toolbar"], [data-conversation-role], .sr-only, script, style';
  const readBody = element => {
    let visited = 0;
    const read = node => {
      if (++visited > 8192) throw new Error('body limit');
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node) || node.matches(excluded)) return '';
      if (node.tagName === 'BR') return '\n';
      let text = '';
      let previousBlock = false;
      for (const child of node.childNodes) {
        const part = read(child);
        if (!part) continue;
        const block = child.nodeType === Node.ELEMENT_NODE && /^(P|DIV|PRE|LI|H[1-6]|BLOCKQUOTE)$/.test(child.tagName);
        if (text && (block || previousBlock) && !text.endsWith('\n') && !part.startsWith('\n')) text += block && previousBlock ? '\n\n' : '\n';
        text += part;
        previousBlock = block;
      }
      return text;
    };
    const text = read(element);
    if (text.length > 65536) throw new Error('text limit');
    return text;
  };
  try {
    for (const root of roots) {
      const all = [root, ...root.querySelectorAll('*')];
      const roles = new Set();
      for (const node of all) {
        const legacy = node.getAttribute('data-message-author-role');
        if (legacy) roles.add(legacy);
        for (const attr of ['data-chatgpt-search-unit-key', 'data-content-search-unit-key']) {
          const key = node.getAttribute(attr);
          if (key && /:(user|assistant)$/.test(key)) roles.add(key.split(':').pop());
        }
        const heading = node.getAttribute('data-conversation-role');
        if (heading) roles.add(heading);
      }
      if (!roles.size && all.some(node => node.matches('[data-markdown-text-style="assistant-message"]'))) roles.add('assistant');
      if (roles.size !== 1) return null;
      const role = [...roles][0];
      if (role !== 'user' && role !== 'assistant') return null;
      if (role === 'assistant' && all.some(node => node.hasAttribute('data-chatgpt-search-unit-key') || node.hasAttribute('data-content-search-unit-key')) && !all.some(node => node.getAttribute('data-conversation-role') === 'assistant')) return null;
      const localIds = new Set();
      for (const node of all) {
        const id = node.getAttribute('data-chatgpt-selection-message-id');
        if (id) localIds.add(id);
        const ids = node.getAttribute('data-chatgpt-search-message-ids');
        if (ids) for (const value of ids.split(/\s+/).filter(Boolean)) localIds.add(value);
      }
      if (localIds.size > 1) return null;
      for (const id of localIds) { if (identities.has(id)) return null; identities.add(id); }
      const selector = role === 'assistant' ? '[data-markdown-text-style="assistant-message"]' : '.text-size-chat.whitespace-pre-wrap';
      let bodies = all.filter(node => node.matches(selector) && visible(node));
      bodies = bodies.filter(node => !bodies.some(parent => parent !== node && parent.contains(node)));
      if (!bodies.length && root.hasAttribute('data-message-author-role')) bodies = [root];
      if (!bodies.length && role === 'assistant') bodies = all.filter(node => node.hasAttribute('data-chatgpt-selection-message-id') && visible(node));
      if (bodies.length === 0 && role === 'user' && localIds.size === 1
        && !all.some(node => node.matches(selector)) && readBody(root).trim() === '') {
        missingBodies++;
        continue;
      }
      if (bodies.length !== 1) return null;
      const body = bodies[0];
      const appNames = Array.from(body.querySelectorAll('a[href^="/plugins/"]')).filter(visible).map(node => readBody(node).trim());
      messages.push({ role, text: readBody(body), appNames, animated: body.hasAttribute('data-markdown-animated') });
    }
    // Finish scanning before classifying absence: later identity conflicts,
    // role conflicts or multiple bodies must never be hidden by hydration.
    if (missingBodies) {
      if (missingBodies === 1 && !messages.some(message => message.role === 'user')) messageObservationState = 'MISSING_BODY';
      return null;
    }
    messageObservationState = 'READY';
    return messages;
  } catch { return null; }
})();
`
