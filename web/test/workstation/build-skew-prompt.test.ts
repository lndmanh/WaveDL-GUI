// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BuildSkewPrompt from '../../app/components/BuildSkewPrompt.vue';

afterEach(() => vi.unstubAllGlobals());

describe('build skew prompt', () => {
  it('stays hidden until the daemon reports a build mismatch', () => {
    const wrapper = mount(BuildSkewPrompt, { props: { visible: false } });

    expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
  });

  it('offers an accessible, user-triggered reload', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const wrapper = mount(BuildSkewPrompt, { props: { visible: true } });

    expect(wrapper.text()).toContain('A newer WaveDL build is available');
    expect(wrapper.get('button').text()).toBe('Reload');
    expect(wrapper.get('[data-slot="alert"]').attributes()).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
    });
    expect(reload).not.toHaveBeenCalled();

    await wrapper.get('button').trigger('click');
    expect(reload).toHaveBeenCalledOnce();
  });
});
