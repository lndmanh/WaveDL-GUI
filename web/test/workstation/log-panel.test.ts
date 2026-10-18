// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import LogPanel from '../../workstation/components/runs/LogPanel.vue';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../workstation/i18n/core';
import type { RunEvent } from '../../workstation/lib/event-stream';
import { eventDiagnostic, eventText } from '../../workstation/lib/run-monitor';

function event(payload: Record<string, unknown>): RunEvent {
  return {
    protocol: 'wavedl-jsonl',
    version: 1,
    run_id: 'run',
    attempt: 2,
    seq: 17,
    ts: '2026-10-13T00:00:00Z',
    type: 'log',
    payload,
  };
}
const prefix = '2026-10-13T00:00:00Z [2:17] log: ';

describe('bounded accessible diagnostic presentation', () => {
  it.each(['message', 'text', 'structured'])(
    'shows omission for oversized %s without mutating the event',
    (kind) => {
      const message = `${'a'.repeat(4092)}🌊${'b'.repeat(20)}`;
      const payload = kind === 'structured' ? { value: message } : { [kind]: message };
      const source = event(payload);
      const before = JSON.stringify(source);
      const rendered = eventDiagnostic(source);
      expect(rendered.truncated).toBe(true);
      expect(rendered.text.startsWith(prefix)).toBe(true);
      expect(rendered.text.endsWith(' …')).toBe(true);
      expect(rendered.text.slice(prefix.length).length).toBeLessThanOrEqual(4096);
      expect(rendered.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
      expect(JSON.stringify(source)).toBe(before);
      expect(eventText(source)).toBe(rendered.text);
    },
  );

  it('retains exact-limit Unicode text and message priority without omission', () => {
    const message = `${'a'.repeat(4094)}🌊`;
    expect(eventDiagnostic(event({ message, text: 'not selected' }))).toEqual({
      text: prefix + message,
      truncated: false,
    });
    expect(eventText(event({ text: 'sóng 波 🌊' }))).toBe(prefix + 'sóng 波 🌊');
  });

  it('renders HTML only as text and exposes a named keyboard-focusable scroll region', () => {
    const message = '<img src=x onerror="alert(1)"><script>injection</script>';
    const wrapper = mount(LogPanel, { props: { events: [event({ message })], truncated: false } });
    const log = wrapper.get('pre');
    expect(log.text()).toBe(prefix + message);
    expect(log.find('img').exists()).toBe(false);
    expect(log.find('script').exists()).toBe(false);
    expect(log.attributes()).toMatchObject({
      role: 'log',
      tabindex: '0',
      'aria-label': 'Runtime diagnostics',
      'aria-live': 'off',
    });
    expect(wrapper.text()).not.toContain('shortened');
    wrapper.unmount();
  });

  it('localizes omission guidance separately from raw events and clears it after replacement', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const events = shallowRef([event({ message: '🌊'.repeat(3000) })]);
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(LogPanel, { events: events.value, truncated: true });
        },
      }),
    );
    expect(wrapper.text()).toContain('Long diagnostic messages are shortened');
    expect(wrapper.text()).toContain('Older diagnostics were omitted');
    expect(wrapper.get('pre').text()).toContain('🌊');
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.text()).toContain('Thông báo chẩn đoán dài được rút gọn');
    expect(wrapper.get('pre').attributes('aria-label')).toBe('Chẩn đoán thời gian chạy');
    expect(wrapper.get('pre').text()).toContain(prefix);
    events.value = [event({ message: 'short' })];
    await nextTick();
    expect(wrapper.text()).not.toContain('Thông báo chẩn đoán dài được rút gọn');
    expect(wrapper.text()).toContain('Các chẩn đoán cũ');
    wrapper.unmount();
  });
});
