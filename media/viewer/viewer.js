// The diagram viewer's page (src/viewer/viewer.ts is the extension side).
// The SVG arrives as text and is shown through an <img> holding a Blob URL:
// as an image, nothing in it can run. The page asks for everything again
// whenever it is created, as it is each time the panel comes back into
// view. All it keeps is which file and diagram it shows, which VS Code
// hands back to bring the panel back after a restart.
(function () {
  const vscode = acquireVsCodeApi();
  const select = document.getElementById('diagrams');
  const status = document.getElementById('status');
  const stage = document.getElementById('stage');
  const image = document.getElementById('diagram');
  let shown = null;

  select.addEventListener('change', () => {
    vscode.postMessage({ type: 'select', index: Number(select.value) });
  });

  window.addEventListener('message', (event) => {
    // VS Code's frame around the page posts the extension's messages with
    // the page's own origin; anything else is not from the extension.
    if (event.origin !== window.origin) {
      return;
    }
    const message = event.data;
    if (message.type === 'diagrams') {
      select.replaceChildren(
        ...message.items.map((label, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = label;
          return option;
        })
      );
      select.value = String(message.selected);
      select.hidden = message.items.length < 2 && message.selected === 0;
      vscode.setState(message.keep);
    } else if (message.type === 'render') {
      const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
      image.src = url;
      image.hidden = false;
      stage.style.background = message.backdrop;
      if (shown !== null) {
        URL.revokeObjectURL(shown);
      }
      shown = url;
    } else if (message.type === 'status') {
      status.textContent = message.text;
      status.classList.toggle('error', message.error === true);
      if (message.clear === true) {
        image.hidden = true;
        stage.style.background = '';
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
