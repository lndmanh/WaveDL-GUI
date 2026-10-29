import { describe, expect, it } from 'vitest';
import {
  entryModel,
  loadRecentModels,
  modelEntries,
  modelEntryKey,
  rememberRecentModel,
} from '../../app/lib/model-entries';
import type { ModelDescription } from '../../app/lib/catalog-api';

function model(id: string, pretrained: boolean): ModelDescription {
  return {
    id,
    displayName: id,
    architectureFamily: 'CNN',
    authorInstitution: 'Example',
    yearPublished: 2020,
    paramsM: 1,
    sizeMb: 4,
    shortDescription: `${id} summary`,
    description: 'Description',
    bestFor: 'Baseline',
    pros: [],
    cons: [],
    computeTier: 'Low',
    tags: [],
    supportedDims: [2],
    category: 'CNNs',
    pretrained,
  };
}
function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set('wavedl.recent-models.v1', initial);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe('model catalogue entries', () => {
  it('derives the entry key from the weights suffix', () => {
    expect(modelEntryKey('resnet18_pretrained')).toBe('resnet18');
    expect(modelEntryKey('resnet18')).toBe('resnet18');
    expect(modelEntryKey('_pretrained')).toBe('');
  });

  it('merges scratch and weights variants into one entry, in catalogue order', () => {
    const scratch = model('resnet18', false);
    const weighted = model('resnet18_pretrained', true);
    const cnn = model('cnn', false);
    const entries = modelEntries([weighted, cnn, scratch]);
    expect(entries.map((entry) => entry.key)).toEqual(['resnet18', 'cnn']);
    expect(entries[0]).toEqual({ key: 'resnet18', scratch, weighted, primary: scratch });
    expect(entries[1]).toEqual({ key: 'cnn', scratch: cnn, weighted: null, primary: cnn });
  });

  it('keeps weights-only architectures, preferring the suffixed id when both claim weights', () => {
    const only = model('vit_base', true);
    const [onlyEntry] = modelEntries([only]);
    expect(onlyEntry).toEqual({ key: 'vit_base', scratch: null, weighted: only, primary: only });

    const unsuffixed = model('convnext', true);
    const suffixed = model('convnext_pretrained', true);
    const [both] = modelEntries([unsuffixed, suffixed]);
    expect(both).toEqual({
      key: 'convnext',
      scratch: null,
      weighted: suffixed,
      primary: suffixed,
    });
    // A suffixed id the catalogue does not mark as weights-capable trains from scratch.
    const misnamed = model('odd_pretrained', false);
    expect(modelEntries([misnamed])).toEqual([
      { key: 'odd', scratch: misnamed, weighted: null, primary: misnamed },
    ]);
    expect(modelEntries([])).toEqual([]);
  });

  it('chooses the catalogue id from the weights choice, falling back to the primary', () => {
    const scratch = model('resnet18', false);
    const weighted = model('resnet18_pretrained', true);
    const [entry] = modelEntries([scratch, weighted]);
    if (!entry) throw new Error('missing fixture');
    expect(entryModel(entry, false)).toBe(scratch);
    expect(entryModel(entry, true)).toBe(weighted);
    const [scratchOnly] = modelEntries([model('cnn', false)]);
    if (!scratchOnly) throw new Error('missing fixture');
    expect(entryModel(scratchOnly, true).id).toBe('cnn');
    const [weightsOnly] = modelEntries([model('vit_base', true)]);
    if (!weightsOnly) throw new Error('missing fixture');
    expect(entryModel(weightsOnly, false).id).toBe('vit_base');
  });
});

describe('recent model entries', () => {
  it('loads only string keys, bounded to four', () => {
    expect(loadRecentModels(null)).toEqual([]);
    expect(loadRecentModels(memoryStorage())).toEqual([]);
    expect(loadRecentModels(memoryStorage('["a", 1, null, "b"]'))).toEqual(['a', 'b']);
    expect(loadRecentModels(memoryStorage('["a","b","c","d","e"]'))).toEqual(['a', 'b', 'c', 'd']);
    expect(loadRecentModels(memoryStorage('{"a":1}'))).toEqual([]);
    expect(loadRecentModels(memoryStorage('{broken'))).toEqual([]);
  });

  it('remembers the newest first without duplicates and keeps four', () => {
    const storage = memoryStorage();
    rememberRecentModel(storage, 'a');
    rememberRecentModel(storage, 'b');
    rememberRecentModel(storage, 'c');
    expect(rememberRecentModel(storage, 'a')).toEqual(['a', 'c', 'b']);
    rememberRecentModel(storage, 'd');
    expect(rememberRecentModel(storage, 'e')).toEqual(['e', 'd', 'a', 'c']);
    expect(JSON.parse(storage.items.get('wavedl.recent-models.v1') ?? '[]')).toEqual([
      'e',
      'd',
      'a',
      'c',
    ]);
    expect(loadRecentModels(storage)).toEqual(['e', 'd', 'a', 'c']);
  });

  it('treats unavailable or refusing storage as an empty history', () => {
    const refusing = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadRecentModels(refusing)).toEqual([]);
    expect(rememberRecentModel(refusing, 'cnn')).toEqual(['cnn']);
    expect(rememberRecentModel(null, 'cnn')).toEqual(['cnn']);
  });
});
