import { deflateSync } from 'node:zlib';

/**
 * Software raster canvas for sprite rendering.
 *
 * PlantUML draws `sprite` definitions — the mechanism behind icon sets
 * like Azure-PlantUML — by allocating a Canvas 2D image buffer, writing
 * RGBA pixels into it and reading the result back as a PNG data URL,
 * which it then embeds in the SVG as an `<image>`. Node has no Canvas, so
 * without these three methods the engine fails with
 * `TypeError: f.createImageData is not a function`.
 *
 * Implementing them in software keeps the promise that rendering needs no
 * native dependency: the pixel buffer is a plain `Uint8ClampedArray` and
 * the PNG is assembled here from `node:zlib`, which is built in.
 *
 * `toDataURL` is easy to overlook. With `createImageData` and
 * `putImageData` present but no encoder, rendering completes without an
 * error and the SVG carries `href="data:image/png;base64,"` — an image
 * element with no image. Sprites therefore need both halves.
 *
 * Only these three are implemented because only these three are called on
 * the SVG sprite path; `getImageData`, `drawImage` and `fillRect` are not.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lazily built CRC-32 table (PNG chunk checksums). */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Buffer): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

/**
 * Encodes an RGBA buffer as a PNG (8-bit, colour type 6, no interlacing).
 * Every scanline uses filter type 0; sprites are small and flat, so the
 * gain from filter heuristics does not pay for the extra code.
 */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  // bytes 10-12 stay zero: deflate compression, adaptive filtering, no interlace.

  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    // Leave the leading filter byte at 0 and copy the scanline after it.
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RasterCanvasContext {
  createImageData(width: number, height: number): ImageDataLike;
  putImageData(image: ImageDataLike): void;
  /** The PNG data URL for whatever was last written, or null if nothing was. */
  toDataURL(): string | null;
}

/**
 * Creates the raster half of a canvas context. State is per canvas
 * element: a diagram with several sprites creates several canvases, and a
 * shared buffer would let one sprite overwrite another.
 */
export function createRasterCanvas(): RasterCanvasContext {
  let pixels: Uint8ClampedArray | null = null;
  let width = 0;
  let height = 0;

  return {
    createImageData(w: number, h: number): ImageDataLike {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },

    putImageData(image: ImageDataLike): void {
      width = image.width;
      height = image.height;
      pixels = image.data;
    },

    toDataURL(): string | null {
      if (pixels === null || width === 0 || height === 0) {
        return null;
      }
      return `data:image/png;base64,${encodePng(width, height, pixels).toString('base64')}`;
    },
  };
}
