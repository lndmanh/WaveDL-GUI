import { z } from 'zod';
import { trainingPreferencesSchema } from '../../app/lib/preferences';

export const trainingDefaultsFormSchema = z.strictObject({ config: trainingPreferencesSchema });

export const dataPreferencesSchema = z.strictObject({ keepSignedIn: z.boolean() });
