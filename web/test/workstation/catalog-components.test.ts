// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import ModelSelector from '../../app/components/catalog/ModelSelector.vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
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
      const valid = {
        source: 'bundled_metadata',
        runtime_verified: false,
        categories: { CNNs: { short_description: 'Convolution', models: ['cnn'] } },
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
            description: 'Guidance only',
            best_for: 'Baseline',
            pros: ['Fast'],
            cons: ['Limited capacity'],
            compute_tier: 'Edge',
            tags: ['baseline'],
            supported_dims: [1, 2, 3],
            is_pretrained: false,
          },
        ],
      };
      let failed = true;
      const session = await connected(async () => {
        if (!failed) return json(valid);
        if (fault === 'outage') return new Response(null, { status: 503 });
        return json(
          fault === 'runtime-claim'
            ? { ...valid, runtime_verified: true }
            : { ...valid, models: [{ ...valid.models[0], supported_dims: [4] }] },
        );
      });
      const wrapper = mount(ModelSelector, { props: { session } });
      await flushPromises();
      expect(session.snapshot().status).toBe(fault === 'outage' ? 'connected' : 'error');
      expect(wrapper.text()).toContain('Model catalogue unavailable');
      expect(wrapper.text()).not.toContain('No matching model descriptions');
      expect(wrapper.text()).toContain('not runtime certification');
      expect(wrapper.findAll('li')).toHaveLength(0);
      expect(wrapper.emitted('select')).toBeUndefined();
      failed = false;
      if (fault === 'outage')
        await wrapper
          .findAll('button')
          .find((button) => button.text() === 'Reload catalogue')
          ?.trigger('click');
      else expect(await session.reconnect('token')).toBe(true);
      await vi.waitFor(() => expect(wrapper.findAll('li')).toHaveLength(1));
      expect(wrapper.text()).not.toContain('Model catalogue unavailable');
      expect(wrapper.text()).toContain('not runtime certification');
      expect(wrapper.text()).toContain('Shape not inspected');
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
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Select file')
      ?.trigger('click');
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
  it('renders model names as plaintext, emits only scoped metadata, and clears it on detach', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const session = await connected(async () =>
      json({
        source: 'bundled_metadata',
        runtime_verified: false,
        categories: { 'Classic CNNs': { short_description: 'Classics', models: ['cnn'] } },
        models: [
          {
            id: 'cnn',
            display_name: name,
            architecture_family: 'CNN',
            author_institution: 'Example',
            year_published: 1989,
            params_m: 1.6,
            size_mb: 6,
            short_description: 'Simple convolutional baseline',
            description: 'Guidance',
            best_for: 'Baseline',
            pros: ['Fast'],
            cons: ['Limited capacity'],
            compute_tier: 'Edge',
            tags: ['baseline'],
            supported_dims: [1, 2, 3],
            is_pretrained: false,
          },
        ],
      }),
    );
    const wrapper = mount(ModelSelector, { props: { session } });
    await flushPromises();
    expect(wrapper.text()).toContain('not runtime certification');
    const shapeGuidance = wrapper.get('button[aria-label^="Shape not inspected:"]');
    expect(shapeGuidance.attributes('aria-label')).toBe(
      'Shape not inspected: Shape guidance unavailable. Select and inspect a dataset from the current daemon; unsupported or unknown sample layouts require runtime review. Model selection remains available.',
    );
    const certification = wrapper
      .findAll('button')
      .find((button) =>
        button
          .attributes('aria-label')
          ?.includes('Bundled architecture descriptions provide guidance only.'),
      );
    expect(certification).toBeDefined();
    expect(certification?.classes()).toContain('border-dashed');
    await certification?.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain(
      'Bundled architecture descriptions provide guidance only. Planning and execution on your daemon validate the actual environment and data compatibility.',
    );
    expect(wrapper.text()).toContain(name);
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('Choose '))
      ?.trigger('click');
    const selection = wrapper.emitted('select')?.[0]?.[0];
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    if (
      !object(selection) ||
      typeof selection.model !== 'string' ||
      typeof selection.daemonId !== 'string'
    )
      throw new Error('Missing model selection');
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    session.detach();
    await flushPromises();
    expect(wrapper.text()).not.toContain(name);
    wrapper.unmount();
  });
  it('shows the full structured catalogue with bounded, composable facets and original choices', async () => {
    const metadata = {
      source: 'bundled_metadata',
      runtime_verified: false,
      ...JSON.parse(
        readFileSync(
          resolve(process.cwd(), '../src/wavedl_daemon/runs/model_metadata.json'),
          'utf8',
        ),
      ),
    } as unknown;
    const session = await connected(async () => json(metadata));
    const wrapper = mount(ModelSelector, { props: { session } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(71);
    expect(wrapper.findAll('[data-testid="facet-family"]')).toHaveLength(5);
    expect(wrapper.findAll('[data-testid="facet-tier"]')).toHaveLength(4);
    expect(wrapper.findAll('[data-testid="facet-dimension"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-testid="facet-category"]')).toHaveLength(8);
    expect(wrapper.find('[data-testid="facet-tag"]').exists()).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Next models')).toBe(false);

    await wrapper
      .findAll('[data-testid="facet-family"]')
      .find((button) => button.text() === 'CNN')
      ?.trigger('click');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(42);
    await wrapper
      .findAll('[data-testid="facet-category"]')
      .find((button) => button.text() === 'Classic CNNs')
      ?.trigger('click');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(9);
    await wrapper.findAll('[data-testid="facet-pretrained"]').at(0)?.trigger('click');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(3);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear filters')
      ?.trigger('click');
    expect(wrapper.findAll('[data-testid="model-card"]')).toHaveLength(71);

    await wrapper.findAll('[data-testid="model-select"]')[0]!.trigger('click');
    const selection = wrapper.getComponent(ModelSelector).emitted('select')?.[0]?.[0];
    expect(selection).toEqual({ model: 'cnn', daemonId: 'daemon-one' });
    expect(() => new CatalogApi(session).assertSelection(selection)).not.toThrow();
    wrapper.unmount();
    session.detach();
  });
  it('unmount aborts outstanding metadata work without cancelling daemon runs', async () => {
    let signal: AbortSignal | null | undefined;
    const session = await connected(async (_url, init) => {
      signal = init?.signal;
      return new Promise(() => undefined);
    });
    const wrapper = mount(ModelSelector, { props: { session } });
    await vi.waitFor(() => expect(signal).toBeDefined());
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    expect(session.snapshot().status).toBe('connected');
    session.detach();
  });
});
