// Operator action authorized by the user for the dedicated acceptance window.
// Explicit target only; never discovers tabs or sends the existing draft.
import assert from 'node:assert/strict'
import { DirectCdpPrimitives } from '../package/lib/browser/index.js'

const [endpoint, targetId] = process.argv.slice(2)
assert.ok(endpoint && targetId, 'Usage: node scripts/clear-product-draft.mjs <dedicated-CDP-endpoint> <explicit-target-id>')
const browser = await DirectCdpPrimitives.connect({ endpoint, targetId })
const signal = AbortSignal.timeout(10000)
const selector = '#prompt-textarea,[role="textbox"][contenteditable="true"]'
const stateExpression = `(() => {
  const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const composer = nodes.length === 1 ? nodes[0] : undefined;
  const selection = document.getSelection();
  return { visible: document.visibilityState === 'visible', count: nodes.length,
    focused: !!composer && (document.activeElement === composer || composer.contains(document.activeElement)),
    selectionInside: !!composer && !!selection && composer.contains(selection.anchorNode) && composer.contains(selection.focusNode),
    empty: !!composer && !(composer.innerText || composer.textContent || '').trim()
      && !composer.querySelector('[contenteditable="false"],[data-mention],[data-lexical-decorator="true"]') };
})()`
try {
  await browser.activateTarget(targetId, signal)
  const initial = await browser.observe(stateExpression, undefined, signal)
  assert.equal(new URL(initial.target.url).origin, 'https://chatgpt.com')
  assert.equal(initial.value.visible, true, 'Dedicated page must be visible')
  assert.equal(initial.value.count, 1, 'Composer must be unique')
  if (!initial.value.empty) {
    let ack = await browser.focus(selector, { expected: initial.target, signal })
    ack = await browser.press('a', 2, { expected: ack.target, signal })
    const selected = await browser.observe(stateExpression, ack.target, signal)
    assert.equal(selected.value.visible && selected.value.focused && selected.value.selectionInside, true, 'Selection must remain inside the visible composer')
    ack = await browser.press('Backspace', 0, { expected: selected.target, signal })
    const final = await browser.observe(stateExpression, ack.target, signal)
    assert.equal(final.value.empty, true, 'Draft cleanup must be observed')
  }
  console.log(JSON.stringify({ operatorDraftCleared: true, noMessageSent: true, targetId }))
} finally {
  browser.close()
}
