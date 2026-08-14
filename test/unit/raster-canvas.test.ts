import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { createRasterCanvas, encodePng } from '../../src/worker/raster-canvas';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads a chunk's payload by type from a PNG buffer. */
function chunkData(png: Buffer, type: string): Buffer | null {
  let offset = 8; // past the signature
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const name = png.toString('latin1', offset + 4, offset + 8);
    if (name === type) {
      return png.subarray(offset + 8, offset + 8 + length);
    }
    offset += 12 + length; // length + type + data + CRC
  }
  return null;
}

describe('encodePng', () => {
  const pixels = new Uint8ClampedArray([
    // 2x2, RGBA: red, green / blue, transparent
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0,
  ]);

  it('writes a well-formed PNG header', () => {
    const png = encodePng(2, 2, pixels);

    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const ihdr = chunkData(png, 'IHDR');
    expect(ihdr).not.toBeNull();
    expect(ihdr?.readUInt32BE(0)).toBe(2); // width
    expect(ihdr?.readUInt32BE(4)).toBe(2); // height
    expect(ihdr?.[8]).toBe(8); // bit depth
    expect(ihdr?.[9]).toBe(6); // RGBA
    expect(chunkData(png, 'IEND')).not.toBeNull();
  });

  it('round-trips the pixels through the IDAT stream', () => {
    const png = encodePng(2, 2, pixels);
    const raw = inflateSync(chunkData(png, 'IDAT') as Buffer);

    // Each scanline is a leading filter byte (0) followed by width*4 bytes.
    expect(raw).toHaveLength(2 * (1 + 2 * 4));
    expect(raw[0]).toBe(0);
    expect([...raw.subarray(1, 9)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(raw[9]).toBe(0);
    expect([...raw.subarray(10, 18)]).toEqual([0, 0, 255, 255, 0, 0, 0, 0]);
  });

  it('starts with the base64 prefix the sanitiser matches on', () => {
    // Keeps encodePng and sanitize.ts's PNG_SIGNATURE_BASE64 in step.
    expect(encodePng(1, 1, new Uint8ClampedArray(4)).toString('base64')).toMatch(/^iVBORw0KGg/);
  });
});

describe('createRasterCanvas', () => {
  it('returns null until pixels are written', () => {
    expect(createRasterCanvas().toDataURL()).toBeNull();
  });

  it('encodes written pixels as a PNG data URL', () => {
    const canvas = createRasterCanvas();
    const image = canvas.createImageData(3, 2);
    image.data.set([1, 2, 3, 255], 0);
    canvas.putImageData(image);

    const url = canvas.toDataURL();
    expect(url).toMatch(/^data:image\/png;base64,iVBORw0KGg/);

    const png = Buffer.from((url as string).slice('data:image/png;base64,'.length), 'base64');
    expect(chunkData(png, 'IHDR')?.readUInt32BE(0)).toBe(3);
    expect(chunkData(png, 'IHDR')?.readUInt32BE(4)).toBe(2);
  });

  it('allocates a zeroed buffer of the requested size', () => {
    const image = createRasterCanvas().createImageData(4, 5);
    expect(image.data).toHaveLength(4 * 5 * 4);
    expect(image.data.every((byte) => byte === 0)).toBe(true);
  });

  it('keeps pixels per canvas so one sprite cannot overwrite another', () => {
    // A diagram with several sprites creates several canvases; a shared
    // buffer would make them all render as whichever drew last.
    const first = createRasterCanvas();
    const second = createRasterCanvas();

    const a = first.createImageData(1, 1);
    a.data.set([255, 0, 0, 255]);
    first.putImageData(a);

    const b = second.createImageData(2, 2);
    b.data.set([0, 0, 255, 255]);
    second.putImageData(b);

    expect(first.toDataURL()).not.toBe(second.toDataURL());
  });
});
