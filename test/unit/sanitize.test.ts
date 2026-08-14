import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { encodePng } from '../../src/worker/raster-canvas';
import { sanitizeSvg } from '../../src/worker/sanitize';

const window = new Window({ url: 'http://localhost/' });

const WRAP = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">${inner}</svg>`;

describe('sanitizeSvg', () => {
  it('keeps the svg root and ordinary shapes intact', () => {
    const out = sanitizeSvg(
      window,
      // CJK fixture text verifies the serialiser round-trips non-ASCII.
      WRAP('<defs/><g><rect x="1" y="1" width="10" height="10"/><text x="5" y="20">日本語</text></g>')
    );

    expect(out).toMatch(/^<svg/);
    expect(out).toContain('<rect');
    expect(out).toContain('日本語');
    expect(out).toContain('viewBox="0 0 100 50"');
  });

  it('removes script elements', () => {
    const out = sanitizeSvg(window, WRAP('<g><script>alert(1)</script><circle r="3"/></g>'));
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<circle');
  });

  it('removes foreignObject, iframe, embed and object elements', () => {
    const out = sanitizeSvg(
      window,
      WRAP('<g><foreignObject><div>x</div></foreignObject><iframe/><embed/><object/><circle r="3"/></g>')
    );
    expect(out).not.toMatch(/foreignObject|iframe|embed|object/i);
    expect(out).toContain('<circle');
  });

  it('removes event handler attributes', () => {
    const out = sanitizeSvg(window, WRAP('<rect width="10" height="10" onclick="bad()" onmouseover="bad()"/>'));
    expect(out).not.toMatch(/\son\w+=/i);
    expect(out).toContain('<rect');
  });

  it('removes external link attributes but keeps fragment references', () => {
    const out = sanitizeSvg(
      window,
      WRAP('<image href="https://evil.example/x.png"/><use href="#marker"/><a href="#ok"><circle r="3"/></a>')
    );
    expect(out).not.toContain('evil.example');
    expect(out).toContain('href="#marker"');
    expect(out).toContain('href="#ok"');
  });

  it('strips event handlers from the root <svg> element itself', () => {
    const out = sanitizeSvg(
      window,
      '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()" viewBox="0 0 10 10"><rect width="1" height="1"/></svg>'
    );
    expect(out).not.toMatch(/onload/i);
    expect(out).toContain('viewBox="0 0 10 10"');
  });

  it('strips javascript: links (PlantUML [[url]] syntax reaches href)', () => {
    const out = sanitizeSvg(window, WRAP('<a href="javascript:alert(1)"><text x="1" y="1">link</text></a>'));
    expect(out).not.toContain('javascript:');
    expect(out).toContain('link');
  });

  it('strips data: URIs in link attributes', () => {
    const out = sanitizeSvg(window, WRAP('<image href="data:text/html;base64,PHNjcmlwdD4="/>'));
    expect(out).not.toContain('data:');
  });

  describe('sprite PNGs', () => {
    // A 1x1 PNG produced by src/worker/raster-canvas.ts. Sprites (Azure and
    // other icon sets) reach the preview as exactly this shape.
    const PNG = encodePng(1, 1, new Uint8ClampedArray([1, 2, 3, 255])).toString('base64');
    const URI = `data:image/png;base64,${PNG}`;

    it('keeps an inline sprite PNG on <image href> and xlink:href', () => {
      const out = sanitizeSvg(window, WRAP(`<image href="${URI}" xlink:href="${URI}" width="8" height="8"/>`));
      expect(out).toContain(URI);
      expect(out).toMatch(/xlink:href="data:image\/png/);
    });

    it('strips a sprite PNG from <a href> — links are never a sprite', () => {
      const out = sanitizeSvg(window, WRAP(`<a href="${URI}"><text x="1" y="1">x</text></a>`));
      expect(out).not.toContain('data:');
      expect(out).toContain('x</text>');
    });

    it('strips it from src, which no sprite uses', () => {
      expect(sanitizeSvg(window, WRAP(`<image src="${URI}"/>`))).not.toContain('data:');
    });

    it('strips a data: URI merely labelled image/png', () => {
      // Correct MIME type, but the payload is not a PNG.
      const fake = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
      expect(sanitizeSvg(window, WRAP(`<image href="${fake}"/>`))).not.toContain('data:');
    });

    it('strips data:image/svg+xml, which can carry script', () => {
      const svgUri = `data:image/svg+xml;base64,${Buffer.from('<svg onload="x()"/>').toString('base64')}`;
      expect(sanitizeSvg(window, WRAP(`<image href="${svgUri}"/>`))).not.toContain('data:');
    });

    it('strips a payload with characters outside the base64 alphabet', () => {
      // Anything that could close the attribute or start a second URI.
      const smuggled = `data:image/png;base64,${PNG}";onerror="x()`;
      expect(sanitizeSvg(window, WRAP(`<image href="${smuggled}"/>`))).not.toContain('data:');
    });
  });

  it('rejects input whose root is not <svg>', () => {
    expect(() => sanitizeSvg(window, '<html><body>nope</body></html>')).toThrow(
      'did not return an SVG document'
    );
  });
});
