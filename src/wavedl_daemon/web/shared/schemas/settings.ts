import { z } from 'zod';
import { keepSignedInSchema, trainingPreferencesSchema } from './preferences';

export const trainingDefaultsFormSchema = z.strictObject({ config: trainingPreferencesSchema });

export const dataPreferencesSchema = z.strictObject({ keepSignedIn: keepSignedInSchema });
