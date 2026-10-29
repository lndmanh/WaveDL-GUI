// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountWithI18n } from './mountWithI18n';
import NumberField from '../../app/components/project/NumberField.vue';

interface FieldProps {
  modelValue: number | null | undefined;
  integer?: boolean;
  step?: 'linear' | 'double' | 'decade';
  min?: number;
  disabled?: boolean;
}

/** Mounts the field as a parent with v-model would, feeding each emitted value back. */
function mountField(props: FieldProps) {
  const emitted: number[] = [];
  const wrapper = mountWithI18n(NumberField, {
    props: {
      id: 'field-lr',
      label: 'Learning rate',
      ...props,
      'onUpdate:modelValue': async (value: number) => {
        emitted.push(value);
        await wrapper.setProps({ modelValue: value });
      },
    },
    attachTo: document.body,
  });
  const input = wrapper.get('input');
  const element = input.element;
  if (!(element instanceof HTMLInputElement)) throw new Error('missing input');
  return {
    wrapper,
    input,
    element,
    emitted,
    decrease: wrapper.get('button[aria-label="Decrease Learning rate"]'),
    increase: wrapper.get('button[aria-label="Increase Learning rate"]'),
  };
}

describe('locale-independent number field', () => {
  it('renders a labelled text input with stepper buttons', () => {
    const { wrapper, element } = mountField({ modelValue: 0.001 });
    expect(element.type).toBe('text');
    expect(element.id).toBe('field-lr');
    expect(element.inputMode).toBe('decimal');
    expect(element.value).toBe('0.001');
    wrapper.unmount();
    const integer = mountField({ modelValue: 128, integer: true });
    expect(integer.element.inputMode).toBe('numeric');
    expect(integer.element.value).toBe('128');
    integer.wrapper.unmount();
  });

  it.each([
    ['0.25', 0.25],
    ['.5', 0.5],
    [' +2 ', 2],
    ['-3', -3],
    ['1e-3', 0.001],
    ['2E+2', 200],
    ['7.', 7],
  ])('emits the number typed as %j', async (text, expected) => {
    const { wrapper, input, emitted } = mountField({ modelValue: 1 });
    await input.setValue(text);
    expect(emitted.at(-1)).toBe(expected);
    wrapper.unmount();
  });

  it.each(['abc', '1,5', '0x10', '1e', '', '--1', 'Infinity'])(
    'emits NaN for unreadable input %j',
    async (text) => {
      const { wrapper, input, emitted } = mountField({ modelValue: 1 });
      await input.setValue(text);
      expect(emitted.at(-1)).toBeNaN();
      wrapper.unmount();
    },
  );

  it("keeps the user's text while focused and reformats on blur", async () => {
    const { wrapper, input, element } = mountField({ modelValue: 0.001, step: 'decade' });
    expect(element.value).toBe('1e-3');
    await input.trigger('focus');
    await input.setValue('0.0050');
    expect(wrapper.props('modelValue')).toBe(0.005);
    expect(element.value).toBe('0.0050');
    await input.trigger('blur');
    expect(element.value).toBe('5e-3');
    expect(wrapper.emitted('blur')).toHaveLength(1);
    wrapper.unmount();
  });

  it.each(['1e', '1e-', '-', '.', 'abc'])(
    'keeps half-typed %j while the bound value becomes NaN',
    async (text) => {
      const { wrapper, input, element } = mountField({ modelValue: 0.001 });
      await input.trigger('focus');
      await input.setValue(text);
      expect(wrapper.props('modelValue')).toBeNaN();
      expect(element.value).toBe(text);
      await input.trigger('blur');
      expect(element.value).toBe(text);
      wrapper.unmount();
    },
  );

  it('reformats external changes even while focused', async () => {
    const { wrapper, input, element } = mountField({ modelValue: 10 });
    await input.trigger('focus');
    await input.setValue('10.0');
    expect(element.value).toBe('10.0');
    await wrapper.setProps({ modelValue: 64 });
    expect(element.value).toBe('64');
    await wrapper.setProps({ modelValue: null });
    expect(element.value).toBe('');
    wrapper.unmount();
  });

  it('steps linear values by one and rounds integers', async () => {
    const { wrapper, increase, decrease, element, emitted } = mountField({ modelValue: 5 });
    await increase.trigger('click');
    expect(element.value).toBe('6');
    await decrease.trigger('click');
    await decrease.trigger('click');
    expect(emitted).toEqual([6, 5, 4]);
    await wrapper.setProps({ modelValue: 0.1 });
    await increase.trigger('click');
    expect(emitted.at(-1)).toBe(1.1);
    wrapper.unmount();
    const integer = mountField({ modelValue: 2.6, integer: true });
    await integer.increase.trigger('click');
    expect(integer.emitted).toEqual([4]);
    integer.wrapper.unmount();
  });

  it('doubles and halves batch-style values', async () => {
    const { wrapper, increase, decrease, element, emitted } = mountField({
      modelValue: 128,
      integer: true,
      step: 'double',
      min: 1,
    });
    await increase.trigger('click');
    expect(element.value).toBe('256');
    await decrease.trigger('click');
    await decrease.trigger('click');
    expect(emitted).toEqual([256, 128, 64]);
    await wrapper.setProps({ modelValue: 1 });
    await decrease.trigger('click');
    expect(emitted.at(-1)).toBe(1);
    await wrapper.setProps({ modelValue: 0 });
    await increase.trigger('click');
    expect(emitted.at(-1)).toBe(1);
    wrapper.unmount();
  });

  it('steps rates through 1-3-10 decades in both directions', async () => {
    const { wrapper, increase, decrease, element, emitted } = mountField({
      modelValue: 0.001,
      step: 'decade',
      min: 0,
    });
    await increase.trigger('click');
    expect(element.value).toBe('3e-3');
    await increase.trigger('click');
    expect(element.value).toBe('0.01');
    await decrease.trigger('click');
    expect(element.value).toBe('3e-3');
    await decrease.trigger('click');
    expect(element.value).toBe('1e-3');
    expect(emitted).toEqual([0.003, 0.01, 0.003, 0.001]);
    // Off-grid values snap to the neighbouring 1-3-10 step.
    await wrapper.setProps({ modelValue: 0.0005 });
    await increase.trigger('click');
    expect(emitted.at(-1)).toBe(0.001);
    await wrapper.setProps({ modelValue: 0.0005 });
    await decrease.trigger('click');
    expect(emitted.at(-1)).toBe(0.0003);
    await wrapper.setProps({ modelValue: 0.002 });
    await decrease.trigger('click');
    expect(emitted.at(-1)).toBe(0.001);
    wrapper.unmount();
  });

  it('never steps below the minimum and starts empty values from it', async () => {
    const { wrapper, decrease, increase, element, emitted } = mountField({
      modelValue: 0,
      integer: true,
      min: 0,
    });
    await decrease.trigger('click');
    expect(emitted).toEqual([0]);
    expect(element.value).toBe('0');
    await wrapper.setProps({ modelValue: null });
    await increase.trigger('click');
    expect(emitted.at(-1)).toBe(1);
    await wrapper.setProps({ modelValue: Number.NaN });
    await decrease.trigger('click');
    expect(emitted.at(-1)).toBe(0);
    wrapper.unmount();
  });

  it('steps with ArrowUp and ArrowDown and ignores other keys', async () => {
    const { wrapper, input, emitted } = mountField({ modelValue: 64, integer: true, step: 'double' });
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
    input.element.dispatchEvent(up);
    await wrapper.vm.$nextTick();
    expect(up.defaultPrevented).toBe(true);
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    await input.trigger('keydown', { key: 'ArrowLeft' });
    expect(emitted).toEqual([128, 64, 32]);
    wrapper.unmount();
  });

  it('does not step while disabled', async () => {
    const { wrapper, input, increase, decrease, element, emitted } = mountField({
      modelValue: 3,
      disabled: true,
    });
    expect(element.disabled).toBe(true);
    expect(increase.attributes('disabled')).toBeDefined();
    expect(decrease.attributes('disabled')).toBeDefined();
    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(emitted).toEqual([]);
    expect(element.value).toBe('3');
    wrapper.unmount();
  });
});
