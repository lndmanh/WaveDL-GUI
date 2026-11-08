import { pathName } from './run-overview';

const plotMessageKeys = new Map<string, string>([
  ['scatter_all.png', 'results.plots.scatter'],
  ['error_histogram.png', 'results.plots.errorHistogram'],
  ['residuals.png', 'results.plots.residuals'],
  ['bland_altman.png', 'results.plots.blandAltman'],
  ['qq_plot.png', 'results.plots.qq'],
  ['error_correlation.png', 'results.plots.errorCorrelation'],
  ['relative_error.png', 'results.plots.relativeError'],
  ['error_cdf.png', 'results.plots.errorCdf'],
  ['prediction_vs_index.png', 'results.plots.predictionIndex'],
  ['error_boxplot.png', 'results.plots.errorBoxplot'],
]);

/** Unknown files keep their filename rather than suggesting an unverified plot type. */
export function artifactPlotLabel(
  path: string,
): { key: string; params?: { index: number } } | null {
  const name = pathName(path).toLowerCase();
  const key = plotMessageKeys.get(name);

  if (key) return { key };
  const sample = /^field_sample_(\d+)\.png$/.exec(name);

  if (!sample) return null;
  const index = Number(sample[1]);

  return Number.isSafeInteger(index)
    ? { key: 'results.plots.fieldSample', params: { index } }
    : null;
}
