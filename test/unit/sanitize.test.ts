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

  describe('what the engine embeds without drawing', () => {
    it('removes the plantuml-src processing instruction, which carries the whole source', () => {
      // The engine appends it inside the top-level group.
      const out = sanitizeSvg(
        window,
        WRAP('<defs/><g><text x="1" y="1">Hello</text><?plantuml-src Syp9J4vLqBLJSCfFKh1Iy4ZDoSa70000?></g>')
      );
      expect(out).not.toContain('<?');
      expect(out).not.toContain('plantuml-src');
      expect(out).toContain('Hello</text>');
    });

    it('removes processing instructions and comments at any depth', () => {
      const out = sanitizeSvg(
        window,
        WRAP('<!--top--><?pi a?><g><!--inner--><g><?pi b?><!--deep--><rect width="1" height="1"/></g></g>')
      );
      expect(out).not.toMatch(/<\?|<!--/);
      expect(out).toContain('<rect');
    });

    it('removes data-* attributes, which name hidden elements and aliases', () => {
      const out = sanitizeSvg(
        window,
        WRAP(
          '<g class="entity" data-qualified-name="internal_alias" id="ent0001" data-source-line="4">' +
            '<title>Shown</title><text x="1" y="1">Shown</text></g>' +
            '<g class="link" data-entity-1="ent0001" data-entity-2="ent0002" data-link-type="dependency" id="lnk3"/>'
        )
      );
      expect(out).not.toMatch(/\sdata-/);
      expect(out).not.toContain('internal_alias');
      // What the picture shows, and what the diagram's own structure uses, stays.
      expect(out).toContain('class="entity"');
      expect(out).toContain('id="ent0001"');
      expect(out).toContain('<title>Shown</title>');
      expect(out).toContain('Shown</text>');
    });

    it('replaces a link out of the document with what it draws, as its title repeats the target', () => {
      // The engine's [[https://zq.example/b go]]: the label is drawn, the target is not.
      const out = sanitizeSvg(
        window,
        WRAP(
          '<a target="_top" href="https://zq.example/b" xlink:href="https://zq.example/b" xlink:type="simple" ' +
            'xlink:actuate="onRequest" xlink:show="new" title="https://zq.example/b" xlink:title="https://zq.example/b">' +
            '<text x="1" y="1" fill="#0000FF">go</text></a>'
        )
      );
      expect(out).not.toMatch(/<a\b/);
      expect(out).not.toContain('zq.example');
      expect(out).not.toContain('xmlns:xlink');
      expect(out).toContain('<text x="1" y="1" fill="#0000FF">go</text>');
    });

    it('removes data-* attributes from the root <svg> element too', () => {
      const out = sanitizeSvg(
        window,
        '<svg xmlns="http://www.w3.org/2000/svg" data-diagram-type="SEQUENCE" viewBox="0 0 10 10"><rect width="1" height="1"/></svg>'
      );
      expect(out).not.toContain('data-');
      expect(out).toContain('viewBox="0 0 10 10"');
    });
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

    it('declares xmlns:xlink when a surviving attribute needs it', () => {
      // The engine writes xlink:href on sprites without declaring the
      // prefix; as a standalone .svg file that is a fatal XML error.
      const out = sanitizeSvg(window, WRAP(`<image xlink:href="${URI}" width="8" height="8"/>`));

      expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
      expect(out).toContain(`xlink:href="${URI}"`);
    });

    it('does not add the xlink declaration when nothing uses the prefix', () => {
      const out = sanitizeSvg(window, WRAP(`<image href="${URI}"/>`));
      expect(out).not.toContain('xmlns:xlink');
    });

    it('does not duplicate an existing xlink declaration', () => {
      const input =
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        `viewBox="0 0 10 10"><image xlink:href="${URI}"/></svg>`;
      const out = sanitizeSvg(window, input);

      expect(out.match(/xmlns:xlink=/g)).toHaveLength(1);
    });
  });

  describe('names written with a prefix', () => {
    // What markup is depends on its namespace, not on the prefix that spells
    // it. A browser that opens the exported file runs these and follows them.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XHTML_NS = 'http://www.w3.org/1999/xhtml';
    const XLINK_NS = 'http://www.w3.org/1999/xlink';

    it('removes a script or foreignObject whatever prefix spells it', () => {
      const out = sanitizeSvg(
        window,
        WRAP(
          `<s:script xmlns:s="${SVG_NS}">alert(1)</s:script><h:script xmlns:h="${XHTML_NS}">alert(2)</h:script>` +
            `<s:foreignObject xmlns:s="${SVG_NS}"><p>x</p></s:foreignObject><circle r="3"/>`
        )
      );

      expect(out).not.toMatch(/script|foreignObject|alert/i);
      expect(out).toContain('<circle');
    });

    it('strips a link written with another prefix for xlink, and unwraps its <a>', () => {
      const out = sanitizeSvg(
        window,
        WRAP(
          `<a xmlns:x="${XLINK_NS}" x:href="https://zq.example/a"><text x="1" y="1">go</text></a>` +
            `<image xmlns:x="${XLINK_NS}" x:href="https://zq.example/i.png" width="8" height="8"/>`
        )
      );

      expect(out).not.toContain('zq.example');
      expect(out).not.toMatch(/<a\b/);
      expect(out).toContain('go</text>');
      expect(out).toContain('<image');
    });

    it('keeps the prefixed attributes the engine writes, and namespace declarations', () => {
      const input =
        `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" xmlns:onx="urn:x" viewBox="0 0 10 10">` +
        '<a href="#t" xlink:title="T" xlink:actuate="onRequest"><text xml:space="preserve">t</text></a></svg>';
      const out = sanitizeSvg(window, input);

      expect(out).toContain('xmlns:onx="urn:x"');
      expect(out).toContain('href="#t"');
      expect(out).toContain('xlink:title="T"');
      expect(out).toContain('xlink:actuate="onRequest"');
      expect(out).toContain('xml:space="preserve"');
    });
  });

  describe('characters XML does not allow', () => {
    // One of them makes the whole file unreadable as XML: an exported SVG
    // shows as a broken image, and the PNG export and the .puml preview,
    // which load the SVG as an image, fail on it.
    it('replaces each with U+FFFD, in text and in attribute values', () => {
      const out = sanitizeSvg(
        window,
        WRAP('<a href="#a" title="T[\u0001]"><text x="1" y="1">C0[\u0000\u0008\u000b\u000c\u000e\u001f]NON[\ufffe\uffff]</text></a>')
      );

      expect(out).toContain('title="T[\ufffd]"');
      expect(out).toContain('C0[\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd]NON[\ufffd\ufffd]');
    });

    it('replaces a surrogate without its pair and keeps a pair', () => {
      const out = sanitizeSvg(window, WRAP('<text x="1" y="1">[\ud800][\udc00][😀]</text>'));
      expect(out).toContain('[\ufffd][\ufffd][😀]');
    });

    it('keeps the characters XML allows: tab, line feed, DEL, C1 controls, other noncharacters', () => {
      const text = 'OK[\t][\n][\u007f][\u0080][\u0085][\u009f][\ufdd0][\ufffd]';
      expect(sanitizeSvg(window, WRAP(`<text x="1" y="1">${text}</text>`))).toContain(text);
    });
  });

  it('rejects input whose root is not <svg>', () => {
    expect(() => sanitizeSvg(window, '<html><body>nope</body></html>')).toThrow(
      'did not return an SVG document'
    );
  });
});
