import { z } from 'zod';
import { CatalogApi, type DataSelection } from './catalog-api';
import { ConnectionSession, ConnectionSessionError } from './connection-session';
import { DaemonApiError } from './daemon-api';

const integer = z
  .number()
  .int()
  .nonnegative()
  .max(8 * 1024 ** 3);
const text = z
  .string()
  .max(256)
  .refine((value) => !value.includes('\0') && new TextEncoder().encode(value).length <= 256);
const variable = z.strictObject({
  name: text,
  dtype: text,
  shape: z.array(integer).max(16),
  sample_count: integer.nullable(),
  declared_bytes: integer,
});
const schema = z.strictObject({
  schema_version: z.literal(1),
  format: z.enum(['npy', 'npz', 'mat', 'h5', 'hdf5']),
  variables: z.array(variable).max(128),
});
export interface DatasetInspection {
  format: string;
  numSamples: number;
  inputKey: string;
  outputKey: string;
  inputShape: number[];
  outputShape: number[];
  inputDtype: string;
  outputDtype: string;
  fileSize: null;
}
export function parseDatasetInspection(
  value: unknown,
  selection: Pick<DataSelection, 'relativePath'>,
): DatasetInspection {
  const fail = (): never => {
    throw new DaemonApiError('response', 'Dataset header metadata cannot be mapped safely.');
  };
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return fail();
  }
  if (bytes > 65536) return fail();
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail();
  const metadata = parsed.data;
  if (metadata.format !== selection.relativePath.split('.').at(-1)?.toLowerCase()) return fail();
  const variables = new Map(metadata.variables.map((item) => [item.name, item]));
  if (
    variables.size !== metadata.variables.length ||
    metadata.variables.reduce((total, item) => total + item.declared_bytes, 0) > 8 * 1024 ** 3
  )
    return fail();
  for (const item of metadata.variables) {
    if (item.shape.length ? item.sample_count !== item.shape[0] : item.sample_count !== null)
      return fail();
  }
  // Priority is shared with wavedl.core.data_keys and the Qt metadata consumer.
  const inputs = ['input_train', 'input_test', 'X', 'data', 'inputs', 'features', 'x']
    .map((key) => variables.get(key))
    .find(Boolean);
  const outputs = ['output_train', 'output_test', 'Y', 'labels', 'outputs', 'targets', 'y']
    .map((key) => variables.get(key))
    .find(Boolean);
  if (
    !inputs ||
    !outputs ||
    !inputs.dtype ||
    !outputs.dtype ||
    !inputs.shape.length ||
    !outputs.shape.length ||
    inputs.shape.length > 8 ||
    outputs.shape.length > 8 ||
    inputs.shape.some((size) => size < 1) ||
    outputs.shape.some((size) => size < 1) ||
    inputs.sample_count !== outputs.sample_count ||
    inputs.sample_count === null
  )
    return fail();
  return {
    format: metadata.format,
    numSamples: inputs.sample_count,
    inputKey: inputs.name,
    outputKey: outputs.name,
    inputShape: inputs.shape.slice(1),
    outputShape: outputs.shape.slice(1).length ? outputs.shape.slice(1) : [1],
    inputDtype: inputs.dtype,
    outputDtype: outputs.dtype,
    fileSize: null,
  };
}
export class DatasetInspectionApi {
  constructor(readonly session: ConnectionSession) {}
  inspect(selection: DataSelection, signal?: AbortSignal): Promise<DatasetInspection> {
    try {
      new CatalogApi(this.session).assertSelection(selection);
      if (selection.kind !== 'file' || !/\.(npz|mat|h5|hdf5)$/i.test(selection.relativePath))
        throw new ConnectionSessionError(
          'request',
          'Select a supported dataset file from this daemon.',
        );
    } catch (error) {
      return Promise.reject(error);
    }
    return this.session.perform(
      async (api, requestSignal) => {
        new CatalogApi(this.session).assertSelection(selection);
        const body = await api.mutate(
          '/api/datasets/inspect',
          { root: selection.root, path: selection.relativePath },
          { signal: requestSignal },
        );
        return parseDatasetInspection(body, selection);
      },
      { signal, timeoutMs: 60000 },
    );
  }
}
