// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import RuntimeFields from '../../app/components/project/RuntimeFields.vue';

const expectedLabels = [
  'Python interpreter',
  'Configured backend',
  'Runtime mode',
  'Device',
  'Machines',
  'Processes per machine',
  'Machine rank',
];

const Context = defineComponent({
  props: { hidden: Boolean },
  setup(props) {
    useForm({
      initialValues: {
        backend: 'local',
        runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu' },
        topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
      },
    });
    return () =>
      h('form', { style: props.hidden ? 'display: none' : undefined }, [
        h(RuntimeFields, { disabled: props.hidden }),
      ]);
  },
});

describe('runtime fields accessible identity', () => {
  it('uniquely associates labels across hidden project and visible result form contexts', async () => {
    const host = defineComponent({
      setup: () => () => h('main', [h(Context, { hidden: true }), h(Context)]),
    });
    const wrapper = mount(host, { attachTo: document.body });
    try {
      await flushPromises();
      const allIds = wrapper.findAll('[id]').map((node) => node.attributes('id'));
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(wrapper.findAll('input, select')).toHaveLength(14);
      for (const form of wrapper.findAll('form')) {
        expect(form.get('fieldset > legend').text()).toBe('Execution environment');
        const controls = form.findAll('input, select');
        expect(form.findAll('label').map((label) => label.text())).toEqual(expectedLabels);
        for (const [index, control] of controls.entries()) {
          const id = control.attributes('id');
          const label = form.get(`label[for="${id}"]`);
          expect(label.text()).toBe(expectedLabels[index]);
          expect(wrapper.findAll(`[id="${id}"]`)).toHaveLength(1);
          const native = control.element;
          if (native instanceof HTMLInputElement || native instanceof HTMLSelectElement) {
            expect(native.labels).toHaveLength(1);
            expect(native.labels?.item(0)).toBe(label.element);
          }
        }
        const interpreter = form.get('input[name="runtime.python"]');
        const description = interpreter.attributes('aria-describedby');
        expect(form.get(`[id="${description}"]`).text()).toContain(
          'Absolute interpreter path selected for the execution host',
        );
      }
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps field names, numeric controls and selectable values independent of DOM identifiers', async () => {
    const wrapper = mount(Context);
    try {
      await flushPromises();
      expect(wrapper.get('input[name="runtime.python"]').element).toHaveProperty(
        'value',
        '/usr/bin/python3',
      );
      expect(
        wrapper
          .get('select[name="backend"]')
          .findAll('option')
          .map((option) => option.attributes('value')),
      ).toEqual(['local', 'slurm']);
      expect(wrapper.findAll('input[type="number"]')).toHaveLength(3);
      const machines = wrapper.get('input[id$="topology-num_machines"]');
      expect(machines.attributes('min')).toBe('1');
      await machines.setValue('2');
      expect(machines.element).toHaveProperty('value', '2');
      expect(wrapper.get('input[id$="topology-machine_rank"]').attributes('min')).toBe('0');
    } finally {
      wrapper.unmount();
    }
  });
});
