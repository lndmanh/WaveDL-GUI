import { nextTick } from 'vue';
import type { DataSelection, ModelSelection } from '../../app/lib/catalog-api';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import type { mountWithI18n } from './mountWithI18n';

type Wrapper = ReturnType<typeof mountWithI18n>;

/** Every ProjectContainer mount loads the catalogue; an unknown route would fail the session. */
export const modelCatalogue = {
  source: 'bundled_metadata',
  runtime_verified: false,
  categories: { cnn: { short_description: 'CNN', models: ['cnn'] } },
  models: [
    {
      id: 'cnn',
      display_name: 'CNN',
      architecture_family: 'CNN',
      author_institution: 'Example',
      year_published: 1989,
      params_m: 1.6,
      size_mb: 6,
      short_description: 'Simple convolutional baseline',
      description: 'Network',
      best_for: 'Waves',
      pros: ['Fast'],
      cons: ['Limited capacity'],
      compute_tier: 'Edge',
      tags: ['baseline'],
      supported_dims: [1],
      is_pretrained: false,
    },
  ],
};

/** The dataset browser and header panel are covered elsewhere; tests emit selections directly. */
export const builderStubs = { DatasetPathPicker: true, DatasetInfoPanel: true };

export function jsonResponse(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function button(wrapper: Wrapper, label: string) {
  const found = wrapper.findAll('button').find((entry) => entry.text() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

/** The single form holding every inspector; submitting it requests a plan. */
export function builderForm(wrapper: Wrapper) {
  return wrapper.get('form[role="tabpanel"]');
}

export function activeBlock(wrapper: Wrapper): string | undefined {
  return wrapper.find('[role="tab"][aria-current="step"]').attributes('id')?.split('-tab-').at(-1);
}

export async function chooseSelections(
  wrapper: Wrapper,
  data: DataSelection,
  model: ModelSelection,
) {
  wrapper.getComponent(DatasetPathPicker).vm.$emit('select', data);
  wrapper.getComponent(ModelInspector).vm.$emit('custom', model);
  await nextTick();
}

/** Node's experimental global hides happy-dom's storage; give each test a fresh, inspectable one. */
export function installMemoryStorage() {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
  return items;
}
