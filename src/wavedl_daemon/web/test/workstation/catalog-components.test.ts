// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import { Select } from '../../app/components/ui/select';
import { ConnectionSession } from './session-fixture';
import { CatalogApi, type ModelDescription } from '../../app/lib/catalog-api';
import { object } from '../../app/lib/daemon-api';
const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
async function connected(work: (url: string, init?: RequestInit) => Promise<Response>) {
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (url, init) =>
      String(url).endsWith('/api/health') ? json(health) : work(String(url), init),
  });
  expect(await session.connect('token')).toBe(true);
  return session;
}
function catalogueModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: id.toUpperCase(),
    architecture_family: 'CNN',
    author_institution: 'Example',
    year_published: 1989,
    params_m: 1.6,
    size_mb: 6,
    short_description: 'Simple convolutional baseline',
    description: 'Guidance only',
    best_for: 'Baseline',
    pros: ['Fast'],
    cons: ['Limited capacity'],
    compute_tier: 'Edge',
    tags: ['baseline'],
    supported_dims: [1, 2, 3],
    is_pretrained: false,
    ...overrides,
  };
}
function catalogue(models: ReturnType<typeof catalogueModel>[]) {
  return {
    source: 'bundled_metadata',
    runtime_verified: false,
    categories: {
      'Classic CNNs': { short_description: 'Classics', models: models.map((model) => model.id) },
    },
    models,
  };
}
const resnetCatalogue = catalogue([
  catalogueModel('cnn'),
  catalogueModel('resnet50', {
    display_name: 'ResNet-50',
    params_m: 25.6,
    compute_tier: 'Medium',
    supported_dims: [1, 2, 3],
  }),
  catalogueModel('resnet50_pretrained', {
    display_name: 'ResNet-50 (Pretrained)',
    params_m: 25.6,
    compute_tier: 'Medium',
    supported_dims: [2],
    is_pretrained: true,
  }),
]);
/** The run builder owns the catalogue; dataset browsing is out of scope here. */
function mountProject(session: ConnectionSession) {
  return mount(ProjectContainer, {
    props: { session },
    global: { stubs: { DatasetPathPicker: true, DatasetInfoPanel: true } },
  });
}
async function openModels(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="guide-step-1"]').trigger('click');
  await flushPromises();
}
function button(wrapper: VueWrapper, text: string) {
  const match = wrapper.findAll('button').find((item) => item.text() === text);
  if (!match) throw new Error(`Missing button ${text}`);
  return match;
}
/** The size filter is a portalled select; choose through the component it binds. */
async function chooseTier(wrapper: VueWrapper, value: string) {
  expect(wrapper.get('[data-testid="model-size-filter"]').attributes('aria-label')).toBe(
    'Compute tier',
  );
  wrapper.getComponent(Select).vm.$emit('update:modelValue', value);
  await nextTick();
}
beforeEach(() => {
  // Recent models and drafts persist per browser; each test starts without any.
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
});
describe('catalogue UI isolation', () => {
  it('keeps reconnect guidance after an invalid browse inventory retires the request scope', async () => {
    let malformed = true;
    const session = await connected(async () =>
      json(malformed ? { roots: [{ id: '../private' }] } : { roots: [{ id: 'data' }] }),
    );
    const wrapper = mount(BrowseContainer, { props: { session } });
    await flushPromises();
    expect(session.snapshot().status).toBe('error');
    expect(wrapper.text()).toContain('Dataset paths are unavailable');
    expect(wrapper.text()).not.toContain('Ask your daemon operator');
    expect(wrapper.get('[data-testid="dataset-path-search"]').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('select')).toBeUndefined();
    malformed = false;
    expect(await session.reconnect('token')).toBe(true);
    await vi.waitFor(() =>
      expect(
        wrapper.get('[data-testid="dataset-path-search"]').attributes('disabled'),
      ).toBeUndefined(),
    );
    expect(wrapper.text()).not.toContain('Dataset paths are unavailable');
    wrapper.unmount();
    session.detach();
  });
  it.each(['malformed', 'runtime-claim', 'outage'])(
    'shows a recoverable %s catalogue failure instead of an empty model result',
    async (fault) => {
      const valid = catalogue([catalogueModel('cnn', { display_name: 'CNN' })]);
      let failed = true;
      const session = await connected(async (url) => {
        if (!url.endsWith('/api/models')) throw new Error(`Unexpected request: ${url}`);
        if (!failed) return json(valid);
        if (fault === 'outage') return new Response(null, { status: 503 });
        return json(
          fault === 'runtime-claim'
            ? { ...valid, runtime_verified: true }
            : { ...valid, models: [{ ...valid.models[0], supported_dims: [4] }] },
        );
      });
      const wrapper = mountProject(session);
      await flushPromises();
      await openModels(wrapper);
      expect(session.snapshot().status).toBe(fault === 'outage' ? 'connected' : 'error');
      expect(wrapper.text()).toContain('Model catalogue unavailable');
      expect(wrapper.text()).not.toContain('No matching model descriptions');
      expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(0);
      expect(wrapper.find('[data-testid="model-select"]').exists()).toBe(false);
      expect(wrapper.getComponent(ModelInspector).props('selection')).toBeNull();
      failed = false;
      if (fault === 'outage') await button(wrapper, 'Reload catalogue').trigger('click');
      else expect(await session.reconnect('token')).toBe(true);
      await vi.waitFor(() => expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(1));
      expect(wrapper.text()).not.toContain('Model catalogue unavailable');
      expect(wrapper.getComponent(ModelInspector).props('selection')).toBeNull();
      wrapper.unmount();
      session.detach();
    },
  );
  it('selects a daemon-resolved file with its original remote path, never a browser path', async () => {
    const session = await connected(async (url) => {
      if (url.endsWith('/api/browse')) return json({ roots: [{ id: 'research' }] });
      if (url.includes('/api/browse?'))
        return json({
          root: 'research',
          path: '',
          entries: [{ name: 'wave.npz', kind: 'file' }],
          total: 1,
          limit: 100,
          offset: 0,
        });
      return json({
        root: 'research',
        relative_path: 'wave.npz',
        kind: 'file',
        path: 'D:\\Research\\wave.npz',
      });
    });
    const wrapper = mount(BrowseContainer, { props: { session } });
    await flushPromises();
    expect(wrapper.getComponent(DatasetPathPicker).props('allowDirectory')).toBe(false);
    expect(wrapper.get('section').attributes('aria-label')).toBe('Dataset path');
    await wrapper.get('[data-testid="dataset-path-search"]').trigger('focus');
    await wrapper.get('[role="option"][data-value="research"]').trigger('click');
    await flushPromises();
    await wrapper.get('button[aria-label="Select file wave.npz"]').trigger('click');
    await flushPromises();
    const selection = wrapper.emitted('select')?.[0]?.[0];
    expect(selection).toEqual({
      root: 'research',
      relativePath: 'wave.npz',
      kind: 'file',
      path: 'D:\\Research\\wave.npz',
      daemonId: 'daemon-one',
    });
    expect(wrapper.find('input[type=file]').exists()).toBe(false);
    wrapper.unmount();
    session.detach();
  });
  it('forwards the optional directory-selection mode and label to the path picker', async () => {
    const session = await connected(async () => json({ roots: [{ id: 'runs' }] }));
    const wrapper = mount(BrowseContainer, {
      props: { session, allowDirectory: true, label: 'Standalone run directory' },
    });
    await flushPromises();
    const picker = wrapper.getComponent(DatasetPathPicker);
    expect(picker.props('allowDirectory')).toBe(true);
    expect(picker.props('label')).toBe('Standalone run directory');
    expect(wrapper.get('section').attributes('aria-label')).toBe('Standalone run directory');
    wrapper.unmount();
    session.detach();
  });
  it('does not show or emit a stale directory result when cancelled', async () => {
    let finish: ((response: Response) => void) | undefined;
    const session = await connected(async (url) =>
      url.endsWith('/api/browse')
        ? json({ roots: [{ id: 'data' }] })
        : new Promise((resolve) => {
            finish = resolve;
          }),
    );
    const wrapper = mount(BrowseContainer, { props: { session } });
    await flushPromises();
    await wrapper.get('[data-testid="dataset-path-search"]').trigger('focus');
    await wrapper.get('[role="option"][data-value="data"]').trigger('click');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Stop browsing')
      ?.trigger('click');
    finish?.(
      json({
        root: 'data',
        path: '',
        entries: [{ name: 'old.npz', kind: 'file' }],
        total: 1,
        offset: 0,
        limit: 100,
      }),
    );
    await flushPromises();
    expect(wrapper.text()).not.toContain('old.npz');
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(session.snapshot().status).toBe('connected');
    wrapper.unmount();
    session.detach();
  });
  it('revokes visible browse choices on session detach', async () => {
    const session = await connected(async () => json({ roots: [{ id: 'secret-root' }] }));
    const wrapper = mount(BrowseContainer, { props: { session } });
    await flushPromises();
    session.detach();
    await flushPromises();
    expect(wrapper.get('[data-testid="dataset-path-search"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
  it('renders model names as plaintext, keeps only a scoped selection, and clears it on detach', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const session = await connected(async () =>
      json(catalogue([catalogueModel('cnn', { display_name: name })])),
    );
    const wrapper = mountProject(session);
    await flushPromises();
    await openModels(wrapper);
    expect(wrapper.get('[data-model-entry="cnn"]').text()).toContain(name);
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.get('[data-model-entry="cnn"]').trigger('click');
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    await flushPromises();
    const selection = wrapper.getComponent(ModelInspector).props('selection');
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    if (!selection) throw new Error('Missing model selection');
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('In use');
    session.detach();
    await flushPromises();
    expect(wrapper.text()).not.toContain(name);
    expect(wrapper.getComponent(ModelInspector).props('selection')).toBeNull();
    expect(() => new CatalogApi(session).assertSelection(selection)).toThrow();
    wrapper.unmount();
  });
  it('walks every row with arrow keys when a recent model is listed twice', async () => {
    window.localStorage.setItem('wavedl.recent-models.v1', JSON.stringify(['b']));
    const session = await connected(async () =>
      json(
        catalogue([
          catalogueModel('a', { params_m: 1 }),
          catalogueModel('b', { params_m: 2 }),
          catalogueModel('c', { params_m: 3 }),
        ]),
      ),
    );
    const models = await new CatalogApi(session).models();
    const wrapper = mount(ModelInspector, {
      props: {
        session,
        models,
        busy: false,
        message: '',
        selection: null,
        pretrained: false,
        inspection: null,
        singleChannel: false,
        disabled: false,
      },
    });
    const list = wrapper.get('[role="listbox"]');
    const active = () => {
      const id = list.attributes('aria-activedescendant');
      return wrapper.findAll('[role="option"]').find((row) => row.attributes('id') === id);
    };
    const visited: string[] = [];
    for (let step = 0; step < 3; step++) {
      await list.trigger('keydown', { key: 'ArrowDown' });
      visited.push(active()?.attributes('data-model-entry') ?? '');
    }
    // Recent b, then the category's a, b, c: the duplicate never traps the cursor.
    expect(visited).toEqual(['a', 'b', 'c']);
    expect(wrapper.findAll('[role="option"][aria-selected="true"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it('lists the full structured catalogue as merged entries with composable search and tier filters', async () => {
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), '../runs/model_metadata.json'), 'utf8'),
    );
    if (!object(parsed) || !Array.isArray(parsed.models)) throw new Error('Invalid metadata');
    const ids = parsed.models.flatMap((model) =>
      object(model) && typeof model.id === 'string' ? [model.id] : [],
    );
    const keys = new Set(ids.map((id) => id.replace(/_pretrained$/, '')));
    expect(ids.filter((id) => id.endsWith('_pretrained')).length).toBeGreaterThan(0);
    const session = await connected(async () =>
      json({ source: 'bundled_metadata', runtime_verified: false, ...parsed }),
    );
    const models = await new CatalogApi(session).models();
    const wrapper = mount(ModelInspector, {
      props: {
        session,
        models,
        busy: false,
        message: '',
        selection: null,
        pretrained: false,
        inspection: null,
        singleChannel: false,
        disabled: false,
      },
    });
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(keys.size);
    expect(wrapper.findAll('[data-model-entry="resnet50"]')).toHaveLength(1);
    expect(wrapper.find('[data-model-entry="resnet50_pretrained"]').exists()).toBe(false);
    // Without an inspected dataset there is nothing to fit against.
    expect(wrapper.find('[aria-label="Compatibility"]').exists()).toBe(false);

    const edge = new Set(
      models.filter((model) => model.computeTier === 'Edge').map((model) => model.id),
    );
    await chooseTier(wrapper, 'Edge');
    const edgeRows = wrapper.findAll('[data-testid="model-card"]');
    expect(edgeRows.length).toBeGreaterThan(0);
    expect(edgeRows.length).toBeLessThan(keys.size);
    for (const row of edgeRows) expect(edge.has(row.attributes('data-model-entry') ?? '')).toBe(true);
    await wrapper.get('[data-testid="model-search"]').setValue('resnet50');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('No matching model descriptions');
    await chooseTier(wrapper, 'any');
    expect(
      wrapper.findAll('[data-testid="model-card"]').map((row) => row.attributes('data-model-entry')),
    ).toEqual(['resnet50']);
    await wrapper.get('[data-testid="model-search"]').setValue('');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(keys.size);

    await wrapper.get('[data-model-entry="cnn"]').trigger('click');
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    const [chosen, pretrained] = wrapper.emitted('choose')?.[0] ?? [];
    expect(pretrained).toBe(false);
    expect(chosen).toMatchObject({ id: 'cnn' });
    const model = models.find((item) => item === chosen);
    if (!model) throw new Error('The chosen model is not the catalogue object');
    const selection = new CatalogApi(session).selectModel(model, models);
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    wrapper.unmount();
    session.detach();
  });
  it('merges scratch and _pretrained catalogue ids into one entry chosen through the weights switch', async () => {
    const session = await connected(async () => json(resnetCatalogue));
    const wrapper = mountProject(session);
    await flushPromises();
    await openModels(wrapper);
    expect(
      wrapper.findAll('[data-testid="model-card"]').map((row) => row.attributes('data-model-entry')),
    ).toEqual(['cnn', 'resnet50']);
    expect(wrapper.find('[data-testid="model-weights-cnn"]').exists()).toBe(false);
    await wrapper.get('[data-model-entry="resnet50"]').trigger('click');
    const weights = wrapper.get('[data-testid="model-weights-resnet50"] [role="switch"]');
    expect(weights.attributes('aria-checked')).toBe('false');
    expect(wrapper.text()).toContain('resnet50');
    await weights.trigger('click');
    expect(
      wrapper.get('[data-testid="model-weights-resnet50"] [role="switch"]').attributes('aria-checked'),
    ).toBe('true');
    expect(wrapper.text()).toContain('resnet50_pretrained');
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    await flushPromises();
    const inspector = wrapper.getComponent(ModelInspector);
    expect(inspector.props('selection')).toEqual({
      model: 'resnet50_pretrained',
      daemonId: 'daemon-one',
    });
    expect(inspector.props('pretrained')).toBe(true);
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('In use');

    await wrapper.get('[data-testid="model-weights-resnet50"] [role="switch"]').trigger('click');
    expect(wrapper.get('[data-testid="model-select"]').text()).toBe('Use this model');
    await wrapper.get('[data-testid="model-select"]').trigger('click');
    await flushPromises();
    expect(inspector.props('selection')).toEqual({ model: 'resnet50', daemonId: 'daemon-one' });
    expect(inspector.props('pretrained')).toBe(false);
    wrapper.unmount();
    session.detach();
  });
  it('validates a custom model ID before selecting it through the daemon', async () => {
    const session = await connected(async () => json(resnetCatalogue));
    const wrapper = mountProject(session);
    await flushPromises();
    await openModels(wrapper);
    await button(wrapper, 'Use a custom model ID…').trigger('click');
    const label = wrapper
      .findAll('label')
      .find((item) => item.text() === 'Custom model registry ID');
    const input = wrapper.get(`input[id="${label?.attributes('for')}"]`);
    for (const invalid of ['', '../escape', 'os.system("x")', 'a'.repeat(129)]) {
      await input.setValue(invalid);
      await button(wrapper, 'Use').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Enter a model registry identifier, not a path or expression.');
      expect(input.attributes('aria-invalid')).toBe('true');
      expect(wrapper.getComponent(ModelInspector).props('selection')).toBeNull();
    }
    await input.setValue('  my_net.v2  ');
    await button(wrapper, 'Use').trigger('click');
    await flushPromises();
    const selection = wrapper.getComponent(ModelInspector).props('selection');
    expect(selection).toEqual({
      model: 'my_net.v2',
      daemonId: 'daemon-one',
      source: 'custom',
      runtimeVerified: false,
    });
    if (!selection) throw new Error('Missing custom selection');
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    expect(wrapper.get('[data-testid="selected-model"]').text()).toContain('my_net.v2');
    expect(wrapper.text()).not.toContain('Enter a model registry identifier');
    expect(wrapper.findAll('label').some((item) => item.text() === 'Custom model registry ID')).toBe(
      false,
    );
    wrapper.unmount();
    session.detach();
  });
  it('unmount aborts outstanding metadata work without cancelling daemon runs', async () => {
    let signal: AbortSignal | null | undefined;
    const session = await connected(async (url, init) => {
      if (url.endsWith('/api/models')) signal = init?.signal;
      return new Promise(() => undefined);
    });
    const wrapper = mountProject(session);
    await vi.waitFor(() => expect(signal).toBeDefined());
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    expect(session.snapshot().status).toBe('connected');
    session.detach();
  });
});
