import type englishClientErrors from '../app/i18n/locales/en/client-errors.json';
import type { z } from 'zod';
import type { clientDiagnosticSchema } from '../shared/schemas/client-diagnostic';
import type { runtimeValues } from '../app/i18n/dynamic-keys';
import type modelSourceHashes from '../app/i18n/model-source-hashes.json';

/** Only UI preferences and client-owned diagnostics use these presentation types. */
export type Locale = 'vi' | 'en';

export type ClientErrorKey = keyof typeof englishClientErrors;

export type ClientDiagnostic = Readonly<
  Omit<z.output<typeof clientDiagnosticSchema>, 'clientMessageParams'>
> & {
  readonly clientMessageParams?: MessageParams;
};

export type ClientMessage = string | ClientDiagnostic;

export type MessageParams = Readonly<Record<string, string | number>>;

export type RuntimeValue = (typeof runtimeValues)[number];

export type BundledModelId = keyof typeof modelSourceHashes;

export type ModelMessageKey =
  | `models.${BundledModelId}.description`
  | `models.${BundledModelId}.bestFor`
  | `models.${BundledModelId}.shortDescription`
  | `models.${BundledModelId}.pros.first`
  | `models.${BundledModelId}.pros.second`;

export type ModelMessageTranslator = (key: ModelMessageKey) => string;

export interface ModelPresentation {
  readonly shortDescription: string;
  readonly pros: readonly string[];
  readonly description: string;
  readonly bestFor: string;
  readonly untranslated: boolean;
}
