// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ResultsContainer from '../../app/components/results/ResultsContainer.vue';
import { ConnectionSession } from './session-fixture';
const run = '22222222-2222-4222-8222-222222222222';
const health = { daemon_id: 'd', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
describe('results publication boundary', () => {
  it('shows explicit published downloads and removes private artifacts after detach', async () => {
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) =>
        String(input).endsWith('/api/health')
          ? json(health)
          : String(input).endsWith('/api/browse')
            ? json({ roots: [] })
            : json({
                generations: [
                  {
                    generation: 'gen-000001',
                    attempt: 1,
                    step: 0,
                    files: { 'private.onnx': { size: 5, sha256: 'a'.repeat(64) } },
                  },
                ],
              }),
    });
    expect(await session.connect('token')).toBe(true);
    const wrapper = mount(ResultsContainer, { props: { session, runId: run } });
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('private.onnx'));
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.find('object').exists()).toBe(false);
    session.detach();
    await flushPromises();
    expect(wrapper.text()).not.toContain('private.onnx');
    wrapper.unmount();
  });
  it('does not create download URLs before an explicit verified action or for active SVG', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) =>
        String(input).endsWith('/api/health')
          ? json(health)
          : String(input).endsWith('/api/browse')
            ? json({ roots: [] })
            : json({
                generations: [
                  {
                    generation: 'gen-000001',
                    attempt: 1,
                    step: 0,
                    files: { 'plot.svg': { size: 5, sha256: 'a'.repeat(64) } },
                  },
                ],
              }),
    });
    await session.connect('token');
    const wrapper = mount(ResultsContainer, { props: { session, runId: run } });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('View PNG');
    wrapper.unmount();
    session.detach();
    create.mockRestore();
  });

  it('reports a verified download request without claiming the browser saved it', async () => {
    const bytes = new TextEncoder().encode('weights');
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artifact');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/health') return json(health);
        if (path === '/api/browse') return json({ roots: [] });
        if (path.endsWith('/artifacts'))
          return json({
            generations: [
              {
                generation: 'gen-000001',
                attempt: 1,
                step: 0,
                files: { 'weights.bin': { size: bytes.length, sha256 } },
              },
            ],
          });
        return new Response(bytes, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(bytes.length),
          },
        });
      },
    });
    await session.connect('token');
    const wrapper = mount(ResultsContainer, { props: { session, runId: run } });
    try {
      await wrapper.get('button').trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('weights.bin'));
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Download')
        ?.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('download requested'));
      expect(wrapper.text()).not.toContain('downloaded');
      expect(click).toHaveBeenCalledOnce();
    } finally {
      wrapper.unmount();
      session.detach();
      create.mockRestore();
      click.mockRestore();
    }
  });
});
