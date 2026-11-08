import { trainingConfigBaseSchema } from './training-request';

/** Presets cannot retarget datasets, models, executable code or checkpoints. */
export const trainingPresetSchema = trainingConfigBaseSchema
  .omit({
    data_path: true,
    model: true,
    import_modules: true,
    constraint_file: true,
    resume: true,
  })
  .partial();
