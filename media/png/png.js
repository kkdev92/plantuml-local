// Draws an SVG into a PNG for the extension, which has no canvas of its
// own (src/extension.ts, drawPng). The SVG is read as an image from a Blob
// URL, so nothing in it runs, and drawn onto a canvas of the size asked
// for, on the given background; the PNG goes back as bytes.
(function () {
  const vscode = acquireVsCodeApi();

  async function draw(message) {
    const url = URL.createObjectURL(new Blob([message.svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = message.width;
      canvas.height = message.height;
      const context = canvas.getContext('2d');
      context.fillStyle = message.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob === null) {
        throw new Error('the canvas gave no PNG');
      }
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.addEventListener('message', (event) => {
    // VS Code's frame around the page posts the extension's messages with
    // the page's own origin; anything else is not from the extension.
    if (event.origin !== window.origin || event.data.type !== 'draw') {
      return;
    }
    draw(event.data).then(
      (data) => vscode.postMessage({ type: 'png', data }),
      (error) => vscode.postMessage({ type: 'error', error: String((error && error.message) || error) })
    );
  });

  vscode.postMessage({ type: 'ready' });
})();
