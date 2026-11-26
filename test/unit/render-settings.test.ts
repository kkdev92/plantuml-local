import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_SVG_SIZE } from '../../src/core/constants';
import { configuredMaxSvgSize } from '../../src/core/render-settings';

describe('configuredMaxSvgSize', () => {
  it.each([1, 8192, Number.MAX_SAFE_INTEGER])('accepts a positive safe integer: %s', (value) => {
    expect(configuredMaxSvgSize(value)).toBe(value);
  });

  it.each([undefined, null, '8192', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'uses the default for an invalid value: %s',
    (value) => {
      expect(configuredMaxSvgSize(value)).toBe(DEFAULT_MAX_SVG_SIZE);
    }
  );
});
