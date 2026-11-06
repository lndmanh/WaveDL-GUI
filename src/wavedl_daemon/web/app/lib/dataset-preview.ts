import { CatalogApi } from './catalog-api';
import { ConnectionSession, ConnectionSessionError } from './connection-session';
import { DaemonApiError } from './daemon-api';
import {
  datasetPreviewSchema,
  datasetPreviewPendingSchema,
  previewValuesSchema,
} from '../../shared/schemas/dataset-preview';
import type { DataSelection } from '~~/types/catalog-api';
import type { Json } from '~~/types/json';
import type { PreviewValues, DatasetPreview, PreviewSample } from '~~/types/dataset-preview';

export class DatasetPreviewPickleRequiredError extends Error {
  constructor() {
    super('Dataset contains pickled arrays');
    this.name = 'DatasetPreviewPickleRequiredError';
  }
}

const product = (values: readonly number[]) => values.reduce((result, value) => result * value, 1);

function boundedIndices(values: readonly number[], width: number) {
  return values.every(
    (value, index) => value < width && (index === 0 || value > (values[index - 1] ?? -1)),
  );
}

function nested(value: PreviewValues, dimensions: readonly number[]): boolean {
  if (!dimensions.length)
    return !Array.isArray(value) && previewValuesSchema.safeParse(value).success;

  return (
    Array.isArray(value) &&
    value.length === dimensions[0] &&
    value.every((item) => nested(item, dimensions.slice(1)))
  );
}

export function parseDatasetPreview(
  value: Json,
  selection: Pick<DataSelection, 'root' | 'relativePath'>,
): DatasetPreview {
  const fail = (): never => {
    throw DaemonApiError.fromKey('response', 'invalidDatasetPreview');
  };

  const parsed = datasetPreviewSchema.safeParse(value);

  if (!parsed.success) return fail();
  const data = parsed.data;
  const format = selection.relativePath.split('.').at(-1)?.toLowerCase();

  if (
    data.format !== format ||
    data.selection.root !== selection.root ||
    data.selection.path !== selection.relativePath
  )
    return fail();
  const rows = data.input_shape[0] ?? 0;
  const xwidth = product(data.input_shape.slice(1));
  const ywidth = product(data.output_shape.slice(1));
  const count = data.sample_indices.length;
  const inputCount = data.input_sample_indices.length;

  if (
    rows !== data.output_shape[0] ||
    !boundedIndices(data.sample_indices, rows) ||
    !data.input_sample_indices.every((index) => data.sample_indices.includes(index))
  )
    return fail();

  const distributions = [
    { histograms: data.input_histograms, width: xwidth, count: inputCount },
    { histograms: data.output_histograms, width: ywidth, count },
  ];

  for (const { histograms, width, count: sampledRows } of distributions) {
    if (
      !boundedIndices(
        histograms.map((item) => item.feature_index),
        width,
      )
    )
      return fail();

    for (const histogram of histograms)
      if (
        histogram.counts.reduce((sum, item) => sum + item, 0) > sampledRows ||
        !histogram.edges.every(
          (item, index) => index === 0 || item >= (histogram.edges[index - 1] ?? item),
        )
      )
        return fail();
  }

  const correlation = data.correlation;

  if (
    !correlation.feature_indices.length ||
    !boundedIndices(correlation.feature_indices, ywidth) ||
    (count <= 1 || correlation.feature_indices.length <= 1
      ? correlation.matrix !== null
      : !nested(correlation.matrix, [
          correlation.feature_indices.length,
          correlation.feature_indices.length,
        ]))
  )
    return fail();

  if (correlation.matrix?.some((row) => row.some((value) => value !== null && Math.abs(value) > 1)))
    return fail();
  const stats = data.input_statistics;

  if (
    !stats.feature_indices.length ||
    !boundedIndices(stats.feature_indices, xwidth) ||
    stats.means.length !== stats.feature_indices.length ||
    stats.stds.length !== stats.feature_indices.length ||
    stats.stds.some((item) => item !== null && item < 0)
  )
    return fail();

  if (
    !data.scatter.feature_indices.length ||
    !boundedIndices(data.scatter.feature_indices, xwidth) ||
    !nested(data.scatter.x, [inputCount, data.scatter.feature_indices.length]) ||
    data.scatter.y.length !== inputCount ||
    data.samples.length > inputCount
  )
    return fail();
  const sampleIds = new Set<number>();

  for (const sample of data.samples) {
    const original = data.input_shape.slice(1);

    if (
      sampleIds.has(sample.sample_index) ||
      !data.input_sample_indices.includes(sample.sample_index) ||
      JSON.stringify(sample.feature_shape) !== JSON.stringify(original) ||
      sample.shape.length !== Math.max(1, original.length) ||
      sample.shape.some((size, index) => size > (original[index] ?? 1)) ||
      !nested(sample.values, sample.shape)
    )
      return fail();
    sampleIds.add(sample.sample_index);
  }

  return data;
}

async function waitForPreviewPoll(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    const timer = setTimeout(finish, 2000);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export class DatasetPreviewApi {
  constructor(readonly session: ConnectionSession) {}
  async preview(
    selection: DataSelection,
    options: { allow_pickle?: boolean; signal?: AbortSignal } = {},
  ): Promise<DatasetPreview> {
    new CatalogApi(this.session).assertSelection(selection);

    if (selection.kind !== 'file' || !/\.(npz|mat|h5|hdf5)$/i.test(selection.relativePath))
      throw ConnectionSessionError.fromKey('request', 'datasetSelectionRequired');

    // Keep the body identical across polls, including the explicit trust decision.
    const body = {
      root: selection.root,
      path: selection.relativePath,
      allow_pickle: options.allow_pickle ?? false,
    };

    try {
      return await this.session.perform(
        async (api, requestSignal) => {
          for (;;) {
            requestSignal.throwIfAborted();
            new CatalogApi(this.session).assertSelection(selection);
            const result = await api.mutate('/api/datasets/preview', body, {
              signal: requestSignal,
              timeoutMs: 45000,
            });

            requestSignal.throwIfAborted();

            if (!datasetPreviewPendingSchema.safeParse(result).success)
              return parseDatasetPreview(result, selection);
            await waitForPreviewPoll(requestSignal);
          }
        },
        { signal: options.signal, timeoutMs: 20 * 60 * 1000 },
      );
    } catch (error) {
      if (
        error instanceof ConnectionSessionError &&
        error.code === 'request' &&
        error.status === 409
      )
        throw new DatasetPreviewPickleRequiredError();
      throw error;
    }
  }
}

export function sampleMatrix(sample: PreviewSample): (number | null)[][] {
  const flat: (number | null)[] = [];

  const visit = (value: PreviewValues): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else flat.push(value);
  };

  visit(sample.values);
  const width = sample.shape.at(-1) ?? 1;

  return Array.from({ length: flat.length / width }, (_, row) =>
    flat.slice(row * width, (row + 1) * width),
  );
}
