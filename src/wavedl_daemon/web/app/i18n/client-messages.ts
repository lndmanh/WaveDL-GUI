import englishClientErrors from './locales/en/client-errors.json';
import vietnameseClientErrors from './locales/vi/client-errors.json';
import englishZodLocale from 'zod/v4/locales/en.js';
import vietnameseZodLocale from 'zod/v4/locales/vi.js';
import { z } from 'zod';
import type { MessageParams, WorkstationLocale } from './core';

export type ClientErrorKey = keyof typeof englishClientErrors;

export type ClientErrorParams = MessageParams;

type ClientErrorCatalog = Record<ClientErrorKey, string>;

export interface ClientDiagnostic {
  readonly clientMessageKey: ClientErrorKey;
  readonly clientMessageParams?: ClientErrorParams;
}

export type ClientMessage = string | ClientDiagnostic;

let validationLocale: WorkstationLocale = 'en';

/** A client-owned diagnostic whose English Error.message remains API-compatible. */
export class ClientError extends Error implements ClientDiagnostic {
  constructor(
    readonly clientMessageKey: ClientErrorKey,
    message = englishClientErrors[clientMessageKey],
    readonly clientMessageParams: ClientErrorParams = {},
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

/** Preserve RangeError semantics for bounded client-side collections. */
export class ClientRangeError extends RangeError implements ClientDiagnostic {
  constructor(
    readonly clientMessageKey: ClientErrorKey,
    message = englishClientErrors[clientMessageKey],
    readonly clientMessageParams: ClientErrorParams = {},
  ) {
    super(message);
    this.name = 'ClientRangeError';
  }
}

export function clientError(key: ClientErrorKey, params: ClientErrorParams = {}): ClientError {
  return new ClientError(key, interpolate(englishClientErrors[key], params), params);
}

export function clientRangeError(
  key: ClientErrorKey,
  params: ClientErrorParams = {},
): ClientRangeError {
  return new ClientRangeError(key, interpolate(englishClientErrors[key], params), params);
}

function interpolate(template: string, params: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const value = params[name];

    return typeof value === 'string' || typeof value === 'number' ? String(value) : `{${name}}`;
  });
}

export function isClientDiagnostic(value: unknown): value is ClientDiagnostic {
  if (value === null || typeof value !== 'object') return false;

  if (!('clientMessageKey' in value)) return false;

  return isClientErrorKey(value.clientMessageKey);
}

function isClientErrorKey(key: unknown): key is ClientErrorKey {
  return typeof key === 'string' && Object.hasOwn(englishClientErrors, key);
}

const localeMessages: Record<WorkstationLocale, ClientErrorCatalog> = {
  en: englishClientErrors,
  vi: vietnameseClientErrors,
};

function translatedClientError(
  locale: WorkstationLocale,
  key: string,
  params: Record<string, unknown>,
): string | undefined {
  if (!isClientErrorKey(key)) return undefined;
  const template = localeMessages[locale][key];

  if (template === undefined) return undefined;

  return interpolate(template, params);
}

/** Use Zod 4's bundled locale maps and stable keys for product-defined custom issues. */
export function configureValidationLocale(locale: WorkstationLocale): void {
  validationLocale = locale;
  z.config({
    localeError:
      locale === 'vi' ? vietnameseZodLocale().localeError : englishZodLocale().localeError,
    customError: (issue) => {
      if (issue.code !== 'custom' || !('params' in issue) || !issue.params) return undefined;
      const key = issue.params.clientMessageKey;

      if (typeof key !== 'string') return undefined;

      return translatedClientError(validationLocale, key, issue.params);
    },
  });
}

/** Resolve schema-owned overrides while retaining Zod's built-in map for other issues. */
export function validationMessage(key: ClientErrorKey, params: ClientErrorParams = {}): string {
  return interpolate(localeMessages[validationLocale][key], params);
}

/** Pure helper for non-component callers; raw or daemon-owned text is never reverse-matched. */
export function translateClientDiagnostic(
  locale: WorkstationLocale,
  diagnostic: ClientMessage | Error,
): string {
  if (!isClientDiagnostic(diagnostic))
    return diagnostic instanceof Error ? diagnostic.message : diagnostic;
  const template = localeMessages[locale][diagnostic.clientMessageKey];

  if (template === undefined) return diagnostic.clientMessageKey;
  const params = diagnostic.clientMessageParams ?? {};

  return interpolate(template, params);
}

configureValidationLocale('en');
