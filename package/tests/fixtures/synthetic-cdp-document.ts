import WebSocket from 'ws'
import { CdpSession, CdpCommandError } from '../../src/browser/cdp-session.ts'

/** Serves test HTML through Chrome Fetch interception in the disposable target.
 * Real origin/routes and real Input are exercised; no ChatGPT network response
 * or product login is involved. Never used against Browser B or user targets. */
export async function syntheticCdpDocument(endpoint: string, targetId: string) {
  const socket = new WebSocket(endpoint.replace('http:', 'ws:') + '/devtools/page/' + targetId, { handshakeTimeout: 2000, maxPayload: 1024 * 1024, perMessageDeflate: false })
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const session = new CdpSession(socket, { timeoutMs: 2000 })
  let html = ''
  let failure: unknown
  session.subscribe((method, params) => {
    if (method === 'Fetch.requestPaused') {
      void session.command('Fetch.fulfillRequest', {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(params.resourceType === 'Document' ? html : '').toString('base64'),
      }).catch(error => {
        // A navigation can cancel a paused request before fulfilment reaches
        // Chrome. Main-document/composer assertions still prove actual delivery.
        if (!(error instanceof CdpCommandError) || error.reason !== 'provider rejected command') failure = error
      })
    }
  })
  await session.command('Fetch.enable', { patterns: [{ urlPattern: 'https://chatgpt.com/*', requestStage: 'Request' }] })
  return {
    serve(options: { apps?: string[]; draft?: string; logout?: boolean; foreignOnInput?: boolean; replaceOnInput?: boolean; baseline?: boolean; paragraphComposer?: boolean; alterParagraph?: boolean; hiddenParagraph?: boolean; persistedControl?: string; persistedApp?: string; persistedReply?: string; duplicatePersistedUser?: boolean; redirectOnLoad?: string; returnFromRedirect?: boolean; persistedMountDelayMs?: number; pendingAppRendering?: boolean; keepPendingAppRendering?: boolean } = {}) {
      html = `<!doctype html><meta charset="utf-8"><title>Synthetic semantic fixture</title>
<style>[role=textbox]{width:450px;min-height:80px;border:1px solid black} button{min-width:180px;min-height:40px}</style>
${options.logout ? '<button>Log in</button>' : '<div role="textbox" contenteditable="true"></div>'}
<div role="listbox"></div>${options.baseline ? '<article data-message-author-role="assistant">old reply</article>' : ''}
<script>
const options = ${JSON.stringify(options)};
window.enterCount = 0; window.sent = []; window.keys = [];
const composer = document.querySelector('[role=textbox]');
if (composer) {
  composer.textContent = options.draft || (location.pathname === '/c/replacement' ? 'replacement draft' : '');
  composer.addEventListener('beforeinput', event => {
    if (options.paragraphComposer && event.data?.includes('\\n')) {
      event.preventDefault();
      const lines = (composer.innerText + event.data).split('\\n');
      const atom = composer.querySelector('[app-mention-display-name]');
      const retained = atom?.cloneNode(true);
      const name = atom?.getAttribute('app-mention-display-name') || '';
      composer.replaceChildren();
      lines.forEach((line, index) => {
        if (options.alterParagraph) line = line.replace('Keep  two', 'Keep two');
        const paragraph = document.createElement('p');
        if (options.hiddenParagraph && index === lines.length - 1) paragraph.hidden = true;
        if (index === 0 && retained && line.startsWith(name)) {
          paragraph.append(retained, document.createTextNode(line.slice(name.length)));
        } else if (line) paragraph.textContent = line;
        else paragraph.append(document.createElement('br'));
        composer.append(paragraph);
      });
    }
  });
  composer.addEventListener('input', () => {
    if (options.foreignOnInput) { history.pushState(null, '', '/c/foreign'); composer.textContent = 'foreign draft'; }
    if (options.replaceOnInput) location.href = '/c/replacement';
  });
  composer.addEventListener('keydown', event => {
    window.keys.push(event.key);
    if (event.key === 'Enter') {
      event.preventDefault(); window.enterCount++; window.sent.push(options.paragraphComposer && composer.querySelector('p')
        ? Array.from(composer.children).map(node => node.textContent).join('\\n') : composer.innerText);
      if (location.pathname === '/') history.pushState(null, '', '/c/promoted');
      composer.textContent = '';
    }
  });
}
for (const app of (options.apps || [])) {
  const button = document.createElement('button'); button.textContent = app;
  button.onclick = () => {
    composer.textContent = '';
    const atom = document.createElement('span'); atom.contentEditable = 'false'; atom.setAttribute('app-mention-display-name', app); atom.textContent = app;
    composer.append(atom); document.querySelector('[role=listbox]').hidden = true;
  };
  document.querySelector('[role=listbox]').append(button);
}
window.addReply = (text, streaming = false) => {
  const node = document.createElement('article'); node.setAttribute('data-message-author-role', 'assistant'); node.textContent = text;
  if (streaming) node.setAttribute('data-markdown-animated', ''); document.body.append(node); return true;
};
if (options.pendingAppRendering) {
  const pending = document.createElement('article'); pending.setAttribute('data-message-author-role', 'user'); pending.id = 'pending-user';
  pending.textContent = '\\u200bDSH with ChatGPT ' + options.persistedControl; document.body.append(pending);
}
const mountPersisted = () => { if (options.keepPendingAppRendering) return; document.querySelector('#pending-user')?.remove(); if (options.persistedControl !== undefined) {
  const user = document.createElement('article'); user.setAttribute('data-message-author-role', 'user');
  const app = document.createElement('a'); app.href = '/plugins/owned-app'; app.textContent = options.persistedApp || 'DSH with ChatGPT';
  user.append(app, document.createTextNode(' ' + options.persistedControl)); document.body.append(user);
  if (options.duplicatePersistedUser) document.body.append(user.cloneNode(true));
}
if (options.persistedReply) window.addReply(options.persistedReply);
};
if (options.persistedMountDelayMs) setTimeout(mountPersisted, options.persistedMountDelayMs); else mountPersisted();
if (options.redirectOnLoad) { const original = location.href; history.replaceState(null, '', options.redirectOnLoad); if (options.returnFromRedirect) history.replaceState(null, '', original); }
</script>`
      if (failure) throw failure
    },
    close() { session.close() },
  }
}
