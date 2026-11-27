import { DEFAULT_MAX_SVG_SIZE } from './constants';

export function configuredMaxSvgSize(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_SVG_SIZE;
}
