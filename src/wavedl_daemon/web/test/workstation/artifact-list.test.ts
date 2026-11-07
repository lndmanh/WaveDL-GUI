import { describe, expect, it } from 'vitest';
import { artifactGroupOf } from '../../app/lib/artifact-list';
import { formatBytes } from '../../app/lib/run-overview';

describe('artifact file grouping', () => {
  it.each([
    ['best_checkpoint/model.safetensors', 'checkpoints'],
    ['fold_1/epoch_12_checkpoint/metrics.json', 'checkpoints'],
    ['interrupted_checkpoint/plot.png', 'checkpoints'],
    ['custom_checkpoint/nested/model.bin', 'checkpoints'],
    ['plots/diagnostic.png', 'plots'],
    ['plots/DIAGNOSTIC.PNG', 'plots'],
    ['metrics/summary.json', 'metrics'],
    ['predictions.csv', 'metrics'],
    ['training.log', 'metrics'],
    ['README.TXT', 'metrics'],
    ['weights.bin', 'other'],
    ['best_checkpoint_backup/plot.svg', 'other'],
    ['model_checkpoint.safetensors', 'other'],
    ['plots/diagnostic.png.tmp', 'other'],
    ['plots.png/notes.json', 'metrics'],
    ['untyped', 'other'],
  ])('classifies %s as %s', (path, expected) => {
    expect(artifactGroupOf(path)).toBe(expected);
  });
});

describe('localized file sizes', () => {
  it.each([
    [0, '0 byte'],
    [1, '1 byte'],
    [999, '999 byte'],
    [1_000, '1 kB'],
    [1_234, '1.2 kB'],
    [1_000_000, '1 MB'],
    [84_123_456, '84.1 MB'],
    [1_000_000_000, '1 GB'],
    [1_234_567_890, '1.2 GB'],
    [1_000_000_000_000, '1,000 GB'],
  ])('formats %s bytes as %s using decimal units', (bytes, expected) => {
    expect(formatBytes(bytes, 'en-US')).toBe(expected);
  });

  it('uses the requested locale for the decimal separator', () => {
    expect(formatBytes(84_123_456, 'vi-VN')).toBe('84,1 MB');
  });

  it('does not display negative or non-finite sizes', () => {
    for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(bytes, 'en-US')).toBe('0 byte');
    }
  });
});
