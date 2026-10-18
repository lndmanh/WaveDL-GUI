import { describe, expect, it } from 'vitest';
import { modelShapeGuidance } from '../../workstation/lib/model-shape-guidance';
import type { DatasetInspection } from '../../workstation/lib/dataset-inspection';

const model = { supportedDims: [1, 2, 3] } as const;
const inspection = (inputShape: number[]): DatasetInspection => ({
  format: 'npz',
  numSamples: 7,
  inputKey: 'X',
  outputKey: 'Y',
  inputShape,
  outputShape: [1],
  inputDtype: 'float32',
  outputDtype: 'float32',
  fileSize: null,
});

describe('model shape guidance', () => {
  it.each([
    { shape: [128], status: 'described', singleChannel: false },
    { shape: [32, 32], status: 'described', singleChannel: false },
    { shape: [32, 32, 32], status: 'described', singleChannel: false },
    { shape: [16, 32, 32], status: 'ambiguous', singleChannel: false },
    { shape: [16, 32, 32], status: 'described', singleChannel: true },
  ])('handles $shape with single_channel=$singleChannel', ({ shape, status, singleChannel }) => {
    const result = modelShapeGuidance(inspection(shape), model, singleChannel);
    expect(result.status).toBe(status);
    expect(result.shape).toBe(shape.join(' × '));
  });
  it('does not strip a channel-looking axis from the training spatial convention', () => {
    expect(modelShapeGuidance(inspection([1, 128]), model)).toMatchObject({
      dimensions: 2,
      status: 'described',
    });
    expect(modelShapeGuidance(inspection([1, 128, 128]), model).status).toBe('ambiguous');
    expect(modelShapeGuidance(inspection([3, 128, 128]), { supportedDims: [2] }).status).toBe(
      'ambiguous',
    );
    expect(modelShapeGuidance(inspection([1, 128, 128]), model, true)).toMatchObject({
      dimensions: 3,
      status: 'described',
    });
  });
  it('reports a bounded mismatch for unsupported rank', () => {
    expect(modelShapeGuidance(inspection([4, 8]), { supportedDims: [1] })).toMatchObject({
      status: 'mismatch',
      dimensions: 2,
    });
  });
  it('does not guess missing inspection data', () => {
    expect(modelShapeGuidance(null, model).status).toBe('unknown');
    expect(modelShapeGuidance(undefined, model).status).toBe('unknown');
  });
  it.each([[], [0], [NaN], [1.5], [1, 2, 3, 4]].map((shape) => ({ shape })))(
    'keeps invalid ranks/sizes $shape unknown',
    ({ shape }) => {
      expect(modelShapeGuidance(inspection(shape), model).status).toBe('unknown');
    },
  );
  it('does not invent a dimensional claim for an empty catalogue description', () => {
    expect(modelShapeGuidance(inspection([32]), { supportedDims: [] }).status).toBe('unknown');
  });
});
