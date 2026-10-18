const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Formats 45231 as "45.2k" for tight card/stat surfaces. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return COMPACT_NUMBER_FORMAT.format(value).toLowerCase();
}
