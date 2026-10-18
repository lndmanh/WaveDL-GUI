// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WorkstationShell from '../../workstation/components/WorkstationShell.vue';

describe('workstation navigation', () => {
  it('offers all implemented destinations without requiring daemon authentication', async () => {
    const wrapper = mount(WorkstationShell, {
      props: { status: 'disconnected', section: 'experiments' },
    });
    const navigation = wrapper.get('nav[aria-label="Sections"]');
    const labels = navigation.findAll('button').map((button) => button.text());
    expect(labels).toEqual([
      'Experiments',
      'New training run',
      'Datasets',
      'Results',
      'Adopt standalone run',
      'Connection',
      'Settings',
    ]);
    const settings = navigation.findAll('button').find((button) => button.text() === 'Settings');
    expect(settings).toBeDefined();
    await settings?.trigger('click');
    expect(wrapper.emitted('navigate')).toEqual([['settings']]);
    wrapper.unmount();
  });
});
