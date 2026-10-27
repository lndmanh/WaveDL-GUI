// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AutomaticPlotStatus from '../../app/components/results/AutomaticPlotStatus.vue';

describe('automatic plot status actions', () => {
  it('offers explicit retry only for a recoverable error and routes acknowledged runs', async () => {
    const wrapper = mount(AutomaticPlotStatus, {
      props: { state: { status: 'error', message: 'Unconfirmed acknowledgment', plotRunId: null } },
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([[]]);
    await wrapper.setProps({
      state: { status: 'submitted', message: 'Acknowledged, not completed', plotRunId: 'plot-id' },
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('monitor')).toEqual([['plot-id']]);
    await wrapper.setProps({
      state: { status: 'unavailable', message: 'Unsupported captured manifest', plotRunId: null },
    });
    expect(wrapper.text()).not.toContain('Retry automatic plots');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('stop')).toEqual([[]]);
    await wrapper.setProps({ state: { status: 'stopped', message: '', plotRunId: null } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
