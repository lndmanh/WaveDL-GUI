import { describe, expect, it } from 'vitest';
import { hashModelSource } from '../../app/i18n/model-descriptions';
import modelSourceHashes from '../../app/i18n/model-source-hashes.json';
import { readFileSync } from 'node:fs';

describe('model source hash', () => {
  it('guards the short description and each displayed pro for all 71 daemon models', () => {
    const { models } = JSON.parse(
      readFileSync('../runs/model_metadata.json', 'utf8'),
    ) as { models: { id: string; short_description: string; pros: string[] }[] };
    expect(models).toHaveLength(71);
    for (const model of models) {
      const hashes = modelSourceHashes[model.id as keyof typeof modelSourceHashes];
      expect(hashes.shortDescription).toBe(hashModelSource(model.short_description));
      expect(model.pros.length).toBeGreaterThanOrEqual(2);
      expect(hashes.pros).toEqual({
        first: hashModelSource(model.pros[0]!),
        second: hashModelSource(model.pros[1]!),
      });
      expect(hashModelSource(`${model.short_description}x`)).not.toBe(hashes.shortDescription);
      expect(hashModelSource(`${model.pros[0]}x`)).not.toBe(hashes.pros.first);
      expect(hashModelSource(`${model.pros[1]}x`)).not.toBe(hashes.pros.second);
    }
  });

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
