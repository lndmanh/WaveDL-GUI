// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutomaticPlots } from '../../app/composables/useAutomaticPlots';
import { ConnectionSession } from './session-fixture';
import { trainingDefaults } from '../../shared/schemas/training-request';
import { DaemonApi, type PlanView, type RunView } from '../../app/lib/daemon-api';

afterEach(() => vi.restoreAllMocks());

describe('page-owned automatic plotting', () => {
  it('disarms an approved workflow on pagehide without cancellation or restoration', async () => {
    // Transport contracts are tested in Node. This mounted test exercises page
    // lifecycle with an acknowledged session, not Happy DOM's Response streams.
    vi.spyOn(DaemonApi.prototype, 'health').mockResolvedValue({
      daemon_id: 'daemon',
      build_id: '1.8.1',
      protocol_min: 1,
      protocol_max: 1,
    });
    const fetcher = vi.fn();
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher,
    });
    expect(await session.connect('page-token')).toBe(true);
    let plots: ReturnType<typeof useAutomaticPlots> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          plots = useAutomaticPlots(session);
          return () => h('div');
        },
      }),
    );
    const run: RunView = {
      run_id: '22222222-2222-4222-8222-222222222222',
      request_id: '33333333-3333-4333-8333-333333333333',
      plan_id: '11111111-1111-4111-8111-111111111111',
      backend: 'local',
      operation: 'train',
      state: 'running',
      attempt: 1,
      submission_requested: true,
      cancellation_requested: false,
      uncertainty: false,
      evidence: null,
    };
    const plan: PlanView = {
      run_id: run.run_id,
      request_id: run.request_id,
      plan_id: run.plan_id,
      preview: {
        target: 'local',
        topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
        manifest_json: JSON.stringify({
          schema_version: 1,
          run_id: run.run_id,
          operation: 'train',
          resolved_config: { ...trainingDefaults, model: 'cnn', data_path: '/approved/train.npz' },
          runtime: {
            python: '/approved/python',
            mode: 'existing',
            device: 'cpu',
            environment: {},
            container: null,
          },
        }),
      },
    };
    // This mounted test isolates page lifecycle; the API suite independently
    // verifies exact-instance approval branding and credential revocation.
    vi.spyOn(DaemonApi.prototype, 'approvedRequest').mockImplementation((candidate) => {
      if (candidate !== plan) throw new Error('Unexpected source approval');
      return {
        backend: 'local',
        operation: 'train',
        config: { ...trainingDefaults, model: 'cnn', data_path: '/approved/train.npz' },
        runtime: { python: '/approved/python', mode: 'existing', device: 'cpu', environment: {} },
        topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
      };
    });
    plots?.capture(run, plan);
    expect(plots?.state.value.status).toBe('armed');
    window.dispatchEvent(new Event('pagehide'));
    expect(plots?.state.value.status).toBe('stopped');
    plots?.capture(run, plan);
    expect(plots?.state.value.status).toBe('stopped');
    wrapper.unmount();
    expect(fetcher).not.toHaveBeenCalled();
    session.detach();
  });
  it('stops on pagehide and disposes its subscription on unmount without server mutations', () => {
    const fetcher = vi.fn();
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher,
    });
    const subscribe = vi.spyOn(session, 'subscribe');
    let plots: ReturnType<typeof useAutomaticPlots> | undefined;
    const wrapper = mount(
      defineComponent({
        setup() {
          plots = useAutomaticPlots(session);
          return () => h('div');
        },
      }),
    );
    expect(subscribe).toHaveBeenCalledOnce();
    const unsubscribe = vi.spyOn(window, 'removeEventListener');
    window.dispatchEvent(new Event('pagehide'));
    expect(plots?.state.value.status).toBe('stopped');
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(fetcher).not.toHaveBeenCalled();
    unsubscribe.mockRestore();
  });
});
