export type ModelShapeGuidance = {
  status: 'described' | 'mismatch' | 'unknown' | 'ambiguous';
  shape: string;
  dimensions: number;
};
