// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/select';
import BrowseContainer from '../../app/components/catalog/BrowseContainer.vue';
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
    expect(wrapper.text()).toContain('Catalogue unavailable');
    expect(wrapper.text()).not.toContain('Ask your daemon operator');
    expect(wrapper.getComponent(Select).props('disabled')).toBe(true);
    expect(wrapper.emitted('select')).toBeUndefined();
    malformed = false;
    expect(await session.reconnect('token')).toBe(true);
    await vi.waitFor(() => expect(wrapper.getComponent(Select).props('disabled')).toBe(false));
    expect(wrapper.text()).not.toContain('Catalogue unavailable');
    expect(wrapper.getComponent(Select).props('disabled')).toBe(false);
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
            description: 'Guidance only',
            best_for: 'Baseline',
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
      expect(wrapper.text()).toContain('Shape guidance unavailable');
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
    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'research');
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
    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'data');
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
    expect(wrapper.getComponent(Select).props('disabled')).toBe(true);
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
            description: 'Guidance',
            best_for: 'Baseline',
            supported_dims: [1, 2, 3],
            is_pretrained: false,
          },
        ],
      }),
    );
    const wrapper = mount(ModelSelector, { props: { session } });
    await flushPromises();
    expect(wrapper.text()).toContain('not runtime certification');
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
