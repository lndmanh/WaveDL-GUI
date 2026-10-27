// @vitest-environment happy-dom
import { computed, defineComponent, h, nextTick, onMounted, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../app/i18n/core';

describe('workstation locale foundation', () => {
  it('interpolates parameters as plain text, without reinterpreting their contents', () => {
    const Consumer = defineComponent({
      setup() {
        const { t } = useI18n({ useScope: 'global' });
        return () => h('p', t('catalog.chooseModelName', { name: '{name}<script>東京</script>' }));
      },
    });
    const wrapper = mount(Consumer);
    expect(wrapper.text()).toBe('Choose {name}<script>東京</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    wrapper.unmount();
  });

  it('updates translations without remounting or resetting an unsaved draft and writes no cookie', async () => {
    const language = shallowRef<WorkstationLocale>('en');
    let mounts = 0;
    const Consumer = defineComponent({
      setup() {
        const { t } = useI18n({ useScope: 'global' });
        const draft = shallowRef('my experiment');
        const label = computed(() => t('catalog.chooseModel'));
        onMounted(() => {
          mounts += 1;
        });
        return () =>
          h('section', [
            h('input', {
              value: draft.value,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement) draft.value = event.target.value;
              },
            }),
            h('button', label.value),
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
    expect(wrapper.get('button').text()).toBe('Chọn mô hình');
    expect(wrapper.get('input').element.value).toBe('unsaved draft');
    language.value = 'en';
    await nextTick();
    expect(wrapper.get('button').text()).toBe('Choose a model');
    expect(mounts).toBe(1);
    expect(document.cookie).toBe('');
    wrapper.unmount();
  });

  it('uses isolated composers for independent mounts', () => {
    const Consumer = defineComponent({
      props: { vietnamese: Boolean },
      setup(props) {
        const { t, locale } = useI18n({ useScope: 'global' });
        if (props.vietnamese) locale.value = 'vi';
        return () => h('p', t('catalog.chooseModel'));
      },
    });
    const vi = mount(Consumer, { props: { vietnamese: true } });
    const en = mount(Consumer);
    expect(vi.text()).toBe('Chọn mô hình');
    expect(en.text()).toBe('Choose a model');
    vi.unmount();
    en.unmount();
  });
});
