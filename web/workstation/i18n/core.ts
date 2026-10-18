/** Workstation-only catalogs: no route, API payload or daemon-log translation. */
export type WorkstationLocale = 'en' | 'vi';
export type MessageParams = Readonly<Record<string, string | number>>;
export interface MessageCatalog<Key extends string> {
  readonly en: Readonly<Record<Key, string>>;
  readonly vi: Readonly<Record<Key, string>>;
}

function placeholders(message: string): string[] {
  return [
    ...new Set(
      [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].flatMap((match) =>
        match[1] ? [match[1]] : [],
      ),
    ),
  ].sort();
}

/** Both languages must have exactly the same keys and named placeholders. */
export function defineMessages<Key extends string>(
  en: Record<Key, string>,
  vi: Record<NoInfer<Key>, string>,
): MessageCatalog<Key> {
  const englishKeys = Object.keys(en).sort();
  const vietnameseKeys = Object.keys(vi).sort();
  if (JSON.stringify(englishKeys) !== JSON.stringify(vietnameseKeys))
    throw new Error('Workstation catalog language keys do not match.');
  for (const key in en) {
    if (typeof en[key] !== 'string' || typeof vi[key] !== 'string')
      throw new Error(`Invalid workstation message: ${key}.`);
    if (JSON.stringify(placeholders(en[key])) !== JSON.stringify(placeholders(vi[key])))
      throw new Error(`Workstation message placeholders do not match: ${key}.`);
  }
  return Object.freeze({ en: Object.freeze({ ...en }), vi: Object.freeze({ ...vi }) });
}

export function translateMessage<Key extends string>(
  catalog: MessageCatalog<Key>,
  locale: WorkstationLocale,
  key: Key,
  params: MessageParams = {},
): string {
  if (locale !== 'en' && locale !== 'vi') throw new Error('Unsupported workstation language.');
  if (!Object.hasOwn(catalog[locale], key)) throw new Error(`Unknown workstation message: ${key}.`);
  return catalog[locale][key].replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (_match: string, name: string) => {
      if (!Object.hasOwn(params, name))
        throw new Error(`Missing workstation message parameter: ${name}.`);
      return String(params[name]);
    },
  );
}

/** Only exact catalog-owned English messages are translated; all other text stays intact. */
export function translateKnownMessage<Key extends string>(
  catalog: MessageCatalog<Key>,
  locale: WorkstationLocale,
  rawEnglish: string,
): string {
  for (const key in catalog.en) {
    if (catalog.en[key] === rawEnglish && placeholders(rawEnglish).length === 0)
      return translateMessage(catalog, locale, key);
  }
  return rawEnglish;
}
