import { describe, expect, it } from 'vitest';
import { artifactPlotLabel } from '../../app/lib/artifact-plots';
import { loadArtifactFileView, saveArtifactFileView } from '../../app/lib/preferences';
import type { PreferenceStorage } from '../../types/preferences';

function storage(): PreferenceStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('artifact plot labels', () => {
  it.each([
    ['scatter_all.png', 'scatter'],
    ['error_histogram.png', 'errorHistogram'],
    ['residuals.png', 'residuals'],
    ['bland_altman.png', 'blandAltman'],
    ['qq_plot.png', 'qq'],
    ['error_correlation.png', 'errorCorrelation'],
    ['relative_error.png', 'relativeError'],
    ['error_cdf.png', 'errorCdf'],
    ['prediction_vs_index.png', 'predictionIndex'],
    ['error_boxplot.png', 'errorBoxplot'],
  ])('names %s using its diagnostic title', (path, key) => {
    expect(artifactPlotLabel(path)).toEqual({ key: `results.plots.${key}` });
    expect(artifactPlotLabel(`plots/${path.toUpperCase()}`)).toEqual({
      key: `results.plots.${key}`,
    });
  });

  it('uses the actual zero-based field sample index and preserves filename fallbacks', () => {
    expect(artifactPlotLabel('plots/field_sample_000.png')).toEqual({
      key: 'results.plots.fieldSample',
      params: { index: 0 },
    });
    expect(artifactPlotLabel('field_sample_012.png')).toEqual({
      key: 'results.plots.fieldSample',
      params: { index: 12 },
    });

    for (const path of ['custom.png', 'scatter_all.png.tmp', 'field_sample_9007199254740992.png'])
      expect(artifactPlotLabel(path)).toBeNull();
  });
});

describe('artifact view preference', () => {
  it('defaults to cards and restores the selected view through the existing preference storage', () => {
    const saved = storage();
    expect(loadArtifactFileView(saved)).toBe('cards');
    expect(saveArtifactFileView('list', saved)).toBe(true);
    expect(loadArtifactFileView(saved)).toBe('list');
    expect(saveArtifactFileView('cards', saved)).toBe(true);
    expect(loadArtifactFileView(saved)).toBe('cards');
  });

  it('ignores invalid persisted values and tolerates unavailable storage', () => {
    const invalid: PreferenceStorage = {
      getItem: () => 'grid',
      setItem: () => {
        throw new Error('Storage blocked');
      },
      removeItem: () => undefined,
    };

    const blocked: PreferenceStorage = {
      ...invalid,
      getItem: () => {
        throw new Error('Storage blocked');
      },
    };

    expect(loadArtifactFileView(invalid)).toBe('cards');
    expect(loadArtifactFileView(blocked)).toBe('cards');
    expect(loadArtifactFileView(null)).toBe('cards');
    expect(saveArtifactFileView('list', blocked)).toBe(false);
    expect(saveArtifactFileView('list', null)).toBe(false);
  });
});
