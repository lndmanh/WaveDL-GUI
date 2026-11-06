export interface DatasetInspection {
  format: string;
  numSamples: number;
  inputKey: string;
  outputKey: string;
  inputShape: number[] | null;
  outputShape: number[];
  inputDtype: string;
  outputDtype: string;
  fileSize: null;
}
