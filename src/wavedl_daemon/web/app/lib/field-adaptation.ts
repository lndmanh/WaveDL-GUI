import { trainingFieldMetadata } from '../../shared/schemas/training-request';
import { trainingFieldMessageKeys } from '../i18n/dynamic-keys';
import type { Json } from '~~/types/json';

type TrainingControlKind = 'boolean' | 'choice' | 'list' | 'number' | 'text';
type Translate = (key: string) => string;

export function trainingFieldAdapter(name: string, defaultValue?: Json) {
  const option = trainingFieldMetadata.find((item) => item.name === name);
  const keys = trainingFieldMessageKeys[name];
  const initialValue = defaultValue === undefined ? option?.default : defaultValue;
  const kind: TrainingControlKind =
    option?.kind === 'boolean'
      ? 'boolean'
      : option?.choices.length
        ? 'choice'
        : option?.multiple
          ? 'list'
          : option?.kind === 'number' || option?.kind === 'integer'
            ? 'number'
            : 'text';

  function messages(translate: Translate, descriptionFallback = name) {
    return {
      label: keys ? translate(keys.label) : name,
      description: keys ? translate(keys.description) : descriptionFallback,
    };
  }

  function listValue(value: string | number): (string | number)[] {
    if (!option || String(value).trim() === '') return [];

    return String(value)
      .split('\n')
      .map((item) =>
        option.kind === 'number' ? (item.trim() === '' ? Number.NaN : Number(item)) : item,
      );
  }

  function textValue(value: string | number): string | null {
    return value === '' && initialValue === null ? null : String(value);
  }

  function choiceValue(value: string | null | undefined): string | undefined {
    return value || option?.choices.find((choice) => choice === initialValue);
  }

  return { option, kind, messages, listValue, textValue, choiceValue };
}

export function fieldListText(value: Json | undefined): string {
  return Array.isArray(value) ? value.join('\n') : '';
}

export function fieldText(value: Json | undefined, nulls: 'empty' | 'stringify' = 'empty'): string {
  return nulls === 'empty' && (value === null || value === undefined) ? '' : String(value);
}

/** Native number inputs use NaN for an empty draft; NumberField keeps null instead. */
export function inputNumberValue(value: string | number): number {
  return value === '' ? Number.NaN : Number(value);
}

export function nullableNumberValue(value: number | null | undefined): number | null {
  return value ?? null;
}

export function inputChoiceValue(value: unknown): string {
  return String(value ?? '');
}
