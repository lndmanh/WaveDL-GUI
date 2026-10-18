// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { computed, defineComponent, h, isReadonly, nextTick, onMounted, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import {
  defineMessages,
  translateKnownMessage,
  translateMessage,
  type WorkstationLocale,
} from '../../workstation/i18n/core';
import {
  provideWorkstationLocale,
  useWorkstationI18n,
} from '../../workstation/composables/useWorkstationI18n';

const messages = defineMessages(
  { save: 'Save', count: '{count} jobs for {name}', failed: 'Request failed.' },
  { save: 'Lưu', count: '{count} tác vụ cho {name}', failed: 'Yêu cầu thất bại.' },
);

describe('workstation locale foundation', () => {
  it('translates typed messages and named parameters without interpreting parameter text', () => {
    expect(translateMessage(messages, 'en', 'save')).toBe('Save');
    expect(translateMessage(messages, 'vi', 'save')).toBe('Lưu');
    expect(translateMessage(messages, 'vi', 'count', { count: 3, name: '{count}<script>' })).toBe(
      '3 tác vụ cho {count}<script>',
    );
    expect(() => translateMessage(messages, 'vi', 'count')).toThrow(
      'Missing workstation message parameter',
    );
    expect(() =>
      translateMessage(messages, 'vi', 'count', Object.create({ count: 3, name: 'inherited' })),
    ).toThrow('Missing workstation message parameter');
  });

  it('rejects mismatched keys and placeholder sets and takes immutable catalog snapshots', () => {
    const en: Record<string, string> = { save: 'Save' };
    expect(() => defineMessages(en, {})).toThrow('language keys');
    expect(() => defineMessages(en, { save: 'Lưu', extra: 'Extra' })).toThrow('language keys');
    expect(() => defineMessages({ count: '{count}' }, { count: '{name}' })).toThrow('placeholders');
    const vi = { save: 'Lưu' };
    const catalog = defineMessages(en, vi);
    en.save = 'Changed';
    vi.save = 'Changed';
    expect(translateMessage(catalog, 'en', 'save')).toBe('Save');
    expect(translateMessage(catalog, 'vi', 'save')).toBe('Lưu');
    expect(Object.isFrozen(catalog.en)).toBe(true);
  });

  it('only translates exact known static English client messages', () => {
    expect(translateKnownMessage(messages, 'vi', 'Request failed.')).toBe('Yêu cầu thất bại.');
    for (const raw of [
      'daemon: Request failed.',
      '/private/Save/model.npz',
      'Request failed.\n',
      '{count} jobs for {name}',
      'backend error 東京',
    ])
      expect(translateKnownMessage(messages, 'vi', raw)).toBe(raw);
  });

  it('defaults isolated consumers to English without cross-instance state', () => {
    const first = useWorkstationI18n(messages);
    const second = useWorkstationI18n(messages);
    expect(first.t('save')).toBe('Save');
    expect(first.locale).not.toBe(second.locale);
    expect(isReadonly(first.locale)).toBe(true);
  });

  it('updates translations reactively without remounting or resetting draft input', async () => {
    const language = shallowRef<WorkstationLocale>('en');
    let mounts = 0;
    const Consumer = defineComponent({
      setup() {
        const { t, locale, translateKnownMessage: known } = useWorkstationI18n(messages);
        const draft = shallowRef('my experiment');
        const label = computed(() => t('save'));
        onMounted(() => {
          mounts += 1;
        });
        expect(isReadonly(locale)).toBe(true);
        return () =>
          h('section', [
            h('input', {
              value: draft.value,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement) draft.value = event.target.value;
              },
            }),
            h('button', label.value),
            h('p', known('Request failed.')),
          ]);
      },
    });
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(language);
        return () => h(Consumer);
      },
    });
    const wrapper = mount(Provider);
    await wrapper.get('input').setValue('unsaved draft');
    language.value = 'vi';
    await nextTick();
    expect(wrapper.get('button').text()).toBe('Lưu');
    expect(wrapper.get('p').text()).toBe('Yêu cầu thất bại.');
    expect(wrapper.get('input').element.value).toBe('unsaved draft');
    language.value = 'en';
    await nextTick();
    expect(wrapper.get('button').text()).toBe('Save');
    expect(wrapper.get('input').element.value).toBe('unsaved draft');
    expect(mounts).toBe(1);
    wrapper.unmount();
  });
});
