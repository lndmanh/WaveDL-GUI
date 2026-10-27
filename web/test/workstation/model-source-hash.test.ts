import { describe, expect, it } from 'vitest';
import { hashModelSource } from '../../app/i18n/model-descriptions';

describe('model source hash', () => {
  it.each([
    ['', '0622e05b3417b3'],
    ['a', '13213ee2be8f6d'],
    ['hello', '1a9f47d6388e6a'],
    ['The quick brown fox jumps over the lazy dog', '07381d2c2953c2'],
    ['東京 wave 🌀', '1fa11f0ddea59e'],
  ])('matches the cyrb53 golden vector for %j', (value, expected) => {
    expect(hashModelSource(value)).toBe(expected);
  });
});
