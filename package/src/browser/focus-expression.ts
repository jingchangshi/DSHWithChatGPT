/** Mechanical typing focus. Appending requires a caret after existing content,
 * including non-editable atoms. No application selector or draft policy. */
export function typingFocusExpression(selector: string): string {
  return `(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    if (nodes.length !== 1) throw new Error('Focus target missing or ambiguous');
    const node = nodes[0]; node.focus();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.setSelectionRange(node.value.length, node.value.length);
    } else if (node.isContentEditable) {
      const selection = getSelection();
      if (!selection) throw new Error('Typing selection unavailable');
      const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
    }
    return true;
  })()`
}
