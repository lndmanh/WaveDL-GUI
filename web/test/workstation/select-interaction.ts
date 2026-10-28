import { flushPromises, type DOMWrapper } from '@vue/test-utils';

export async function openSelect<E extends Element>(trigger: DOMWrapper<E>) {
  await trigger.trigger('pointerdown', {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
    pointerId: 1,
  });
  await flushPromises();
}

export async function pressSelectOption(value: string) {
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="option"][data-value]'),
  ).find((candidate) => candidate.getAttribute('data-value') === value);
  if (!option) throw new Error(`Missing Select option ${value}`);

  option.focus();
  option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flushPromises();
}

export async function chooseSelectOption<E extends Element>(trigger: DOMWrapper<E>, value: string) {
  await openSelect(trigger);
  await pressSelectOption(value);
}
