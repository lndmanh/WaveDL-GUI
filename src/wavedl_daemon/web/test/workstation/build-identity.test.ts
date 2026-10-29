import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIENT_BUILD_ID } from '../../app/lib/build-identity';

describe('bundled daemon compatibility identity', () => {
  it('matches the Python package version rather than the frontend package version', () => {
    const source = readFileSync(
      new URL('../../../../wavedl/__init__.py', import.meta.url),
      'utf8',
    );
    const expected = source.match(/^__version__ = "([A-Za-z0-9.+_-]+)"$/m)?.[1];
    expect(expected).toBeDefined();
    expect(CLIENT_BUILD_ID).toBe(expected);
  });
});
