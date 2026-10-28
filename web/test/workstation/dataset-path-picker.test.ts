// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import type { DataSelection } from '../../app/lib/catalog-api';
import { ConnectionSession } from './session-fixture';

const health = {
  daemon_id: 'dataset-daemon',
  build_id: '1.8.1',
  protocol_min: 1,
  protocol_max: 1,
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

describe('dataset path picker', () => {
  it('searches daemon roots and paths, navigates breadcrumbs, and emits only a resolved file', async () => {
    const requests: string[] = [];
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
        if (url.pathname === '/api/health') return json(health);
        if (url.pathname === '/api/browse' && !url.search)
          return json({ roots: [{ id: 'science' }, { id: 'archive' }] });
        if (url.pathname === '/api/browse' && url.searchParams.get('root') === 'science') {
          const path = url.searchParams.get('path');
          return json({
            root: 'science',
            path,
            entries:
              path === 'runs'
                ? [{ name: 'wave.npz', kind: 'file' }]
                : [
                    { name: 'runs', kind: 'directory' },
                    { name: 'wave.npz', kind: 'file' },
                  ],
            total: path === 'runs' ? 1 : 2,
            limit: 100,
            offset: 0,
          });
        }
        if (url.pathname === '/api/browse/resolve')
          return json({
            root: 'science',
            relative_path: 'runs/wave.npz',
            path: '/srv/science/runs/wave.npz',
            kind: 'file',
          });
        throw new Error(`Unexpected request ${url.pathname}${url.search}`);
      },
    });
    expect(await owner.connect('credential')).toBe(true);

    const wrapper = mount(DatasetPathPicker, { props: { session: owner } });
    await flushPromises();
    const search = wrapper.get('[role="combobox"]');
    expect(search.attributes('data-testid')).toBe('dataset-path-search');
    await search.trigger('focus');
    await search.setValue('science');
    expect(wrapper.get('[role="option"][data-value="science"]').text()).toContain('science');
    await search.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.get('[aria-label="Dataset path"]').text()).toContain('science');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'runs')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="Dataset path"]').text()).toContain('runs');

    await search.trigger('focus');
    await search.setValue('wave.npz');
    const fileOption = wrapper.get('[role="option"][data-value="science/runs/wave.npz"]');
    await fileOption.trigger('click');
    await flushPromises();

    const selection = wrapper.emitted('select')?.[0]?.[0] as DataSelection | undefined;
    expect(selection).toEqual({
      root: 'science',
      relativePath: 'runs/wave.npz',
      path: '/srv/science/runs/wave.npz',
      kind: 'file',
      daemonId: 'dataset-daemon',
    });
    expect(requests).toContain('POST /api/browse/resolve');
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    wrapper.unmount();
    owner.detach();
  });
});
