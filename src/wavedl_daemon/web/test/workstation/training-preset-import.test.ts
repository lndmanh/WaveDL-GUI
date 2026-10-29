// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import { trainingDefaults } from '../../shared/schemas/training-request';
import { compactNumber } from '../../app/lib/training-layout';
import { ConnectionSession } from './session-fixture';

const cnn = {
  id: 'cnn',
  display_name: 'CNN',
  architecture_family: 'CNN',
  author_institution: 'Example',
  year_published: 1989,
  params_m: 1.6,
  size_mb: 6,
  short_description: 'Simple convolutional baseline',
  description: 'Network',
  best_for: 'Waves',
  pros: ['Fast'],
  cons: ['Limited capacity'],
  compute_tier: 'Edge',
  tags: ['baseline'],
  supported_dims: [2],
  is_pretrained: false,
};

async function setup() {
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const plans: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === '/api/health')
      return json({ daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
    if (path === '/api/browse' && !url.search) return json({ roots: [{ id: 'data' }] });
    if (path === '/api/browse/resolve') {
      const body: unknown = JSON.parse(String(init?.body));
      const relative =
        body !== null && typeof body === 'object' && 'path' in body ? body.path : undefined;
      if (relative === '')
        return json({ root: 'data', relative_path: '', path: '/data', kind: 'directory' });
      if (relative === 'train.npz')
        return json({
          root: 'data',
          relative_path: 'train.npz',
          path: '/data/train.npz',
          kind: 'file',
        });
      return json({ detail: 'Not found' }, 404);
    }
    if (path === '/api/models')
      return json({
        source: 'bundled_metadata',
        runtime_verified: false,
        categories: { cnn: { short_description: 'CNN', models: ['cnn'] } },
        models: [cnn],
      });
    if (path === '/api/runs/plan') {
      plans.push(String(init?.body));
      return json({
        plan_id: '11111111-1111-4111-8111-111111111111',
        run_id: '22222222-2222-4222-8222-222222222222',
        request_id: '33333333-3333-4333-8333-333333333333',
        preview: {},
      });
    }
    return json({ detail: 'Not needed by the import flow' }, 404);
  });
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher,
  });
  expect(await session.connect('credential')).toBe(true);
  const wrapper = mount(ProjectContainer, { props: { session } });
  await flushPromises();
  return { wrapper, session, plans };
}

async function upload(wrapper: VueWrapper, name: string, text: string) {
  const input = wrapper.get('#training-config-import');
  if (!(input.element instanceof HTMLInputElement)) throw new Error('Missing file input');
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], name, { type: 'application/yaml' }));
  input.element.files = transfer.files;
  await input.trigger('change');
  await flushPromises();
  await vi.waitFor(() => expect(wrapper.find('.run-notice[role="status"]').exists()).toBe(true));
}

function notice(wrapper: VueWrapper): string {
  return wrapper.get('.run-notice[role="status"]').text();
}
function fieldValue(wrapper: VueWrapper, name: string): string {
  const control = wrapper.get(`[id$="-training-${name}"]`).element;
  return control instanceof HTMLInputElement ? control.value : '';
}
async function dismiss(wrapper: VueWrapper) {
  await wrapper.get('.run-notice button[aria-label="Dismiss"]').trigger('click');
  await flushPromises();
}

/** Imports dataset and model through the menu's file input, then plans so there is an approval to protect. */
async function planned() {
  const fixture = await setup();
  await upload(
    fixture.wrapper,
    'base.yaml',
    'data_path: /data/train.npz\nmodel: cnn\nepochs: 50\n',
  );
  expect(notice(fixture.wrapper)).toContain('Imported base.yaml · 1 training values');
  expect(fixture.wrapper.get('[data-testid="selected-dataset"]').text()).toContain('train.npz');
  expect(fixture.wrapper.get('[aria-current="step"]').text()).toContain('Training');
  expect(fieldValue(fixture.wrapper, 'epochs')).toBe('50');
  await dismiss(fixture.wrapper);
  await fixture.wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
  await fixture.wrapper.get('form[role="tabpanel"]').trigger('submit');
  await flushPromises();
  await vi.waitFor(() => expect(fixture.wrapper.find('#approved-plan-title').exists()).toBe(true));
  expect(fixture.plans).toHaveLength(1);
  return fixture;
}

describe('mounted training config import', () => {
  it.each([
    ['broken.yaml', 'epochs: [unclosed', 'This file is not a WaveDL training configuration.'],
    ['list.yaml', '- epochs\n- 100\n', 'This file is not a WaveDL training configuration.'],
    ['array.json', '[{"epochs": 100}]', 'This file is not a WaveDL training configuration.'],
    ['alias.yaml', 'base: &a 1\nepochs: *a\n', 'This file is not a WaveDL training configuration.'],
  ])(
    'rejects unreadable %s without changing the draft or its existing approval',
    async (name, text, detail) => {
      const fixture = await planned();
      try {
        const calls = fixture.plans.length;
        await upload(fixture.wrapper, name, text);
        expect(notice(fixture.wrapper)).toContain(`Couldn’t import ${name}`);
        expect(notice(fixture.wrapper)).toContain(detail);
        expect(fixture.wrapper.find('.run-notice button').text()).not.toContain('Undo');
        expect(fixture.wrapper.find('#approved-plan-title').exists()).toBe(true);
        expect(fieldValue(fixture.wrapper, 'epochs')).toBe('50');
        expect(fixture.wrapper.get('[data-testid="selected-dataset"]').text()).toContain(
          'train.npz',
        );
        expect(fixture.plans).toHaveLength(calls);
      } finally {
        fixture.wrapper.unmount();
        fixture.session.detach();
      }
    },
  );

  it('rejects a file over the 64 KiB limit before reading it', async () => {
    const fixture = await planned();
    try {
      await upload(fixture.wrapper, 'huge.yaml', `epochs: 100\n#${'x'.repeat(64 * 1024)}\n`);
      expect(notice(fixture.wrapper)).toContain('Configuration files are limited to 64 KiB.');
      expect(fixture.wrapper.find('#approved-plan-title').exists()).toBe(true);
      expect(fieldValue(fixture.wrapper, 'epochs')).toBe('50');
    } finally {
      fixture.wrapper.unmount();
      fixture.session.detach();
    }
  });

  it('applies safe JSON training values, keeps dataset, model and runtime, invalidates approval and can undo', async () => {
    const fixture = await planned();
    try {
      const { wrapper } = fixture;
      await upload(
        wrapper,
        'preset.json',
        JSON.stringify({ epochs: 123, lr: 0.004, batch_size: 32, output_dir: '/unsafe', cv: -1 }),
      );
      expect(notice(wrapper)).toContain('Imported preset.json · 3 training values');
      expect(notice(wrapper)).toContain('Not applied: output_dir, cv.');
      expect(fieldValue(wrapper, 'epochs')).toBe('123');
      expect(fieldValue(wrapper, 'lr')).toBe(compactNumber(0.004));
      expect(fieldValue(wrapper, 'batch_size')).toBe('32');
      expect(fieldValue(wrapper, 'cv')).toBe(String(trainingDefaults.cv));
      expect(wrapper.find('#approved-plan-title').exists()).toBe(false);
      expect(wrapper.get('[data-testid="selected-dataset"]').text()).toContain('train.npz');
      expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('CNN');
      expect(wrapper.get('input[name="runtime.python"]').element).toHaveProperty(
        'value',
        '/usr/bin/python3',
      );

      const undo = wrapper.findAll('.run-notice button').find((button) => button.text() === 'Undo');
      if (!undo) throw new Error('Missing Undo');
      await undo.trigger('click');
      await flushPromises();
      expect(wrapper.find('.run-notice').exists()).toBe(false);
      expect(fieldValue(wrapper, 'epochs')).toBe('50');
      expect(fieldValue(wrapper, 'lr')).toBe(compactNumber(trainingDefaults.lr));
      expect(fieldValue(wrapper, 'batch_size')).toBe(String(trainingDefaults.batch_size));
      expect(wrapper.get('[data-testid="selected-dataset"]').text()).toContain('train.npz');
      expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('CNN');
      expect(wrapper.get('input[name="runtime.python"]').element).toHaveProperty(
        'value',
        '/usr/bin/python3',
      );
      // Undo restores the draft, not the discarded approval: planning again is explicit.
      expect(wrapper.find('#approved-plan-title').exists()).toBe(false);
      expect(fixture.plans).toHaveLength(1);
    } finally {
      fixture.wrapper.unmount();
      fixture.session.detach();
    }
  });

  it('reports a dataset and model this daemon does not have without dropping the current ones', async () => {
    const fixture = await planned();
    try {
      const { wrapper } = fixture;
      await upload(
        wrapper,
        'elsewhere.yaml',
        'data_path: /elsewhere/train.npz\nmodel: not/a-model\nepochs: 70\n',
      );
      expect(notice(wrapper)).toContain('Imported elsewhere.yaml · 1 training values');
      expect(notice(wrapper)).toContain(
        'Not found on this daemon: /elsewhere/train.npz, not/a-model.',
      );
      expect(fieldValue(wrapper, 'epochs')).toBe('70');
      expect(wrapper.get('[data-testid="selected-dataset"]').text()).toContain('train.npz');
      expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('CNN');
    } finally {
      fixture.wrapper.unmount();
      fixture.session.detach();
    }
  });

  it('refuses imported code and checkpoint fields by name and applies the rest', async () => {
    const fixture = await planned();
    try {
      const { wrapper } = fixture;
      await upload(
        wrapper,
        'foreign.json',
        JSON.stringify({ import_modules: ['foreign.module'], resume: '/foreign/ckpt.pth', epochs: 33 }),
      );
      expect(wrapper.get('.run-notice').attributes('data-tone')).toBe('warning');
      expect(notice(wrapper)).toContain('Imported foreign.json · 1 training values');
      expect(notice(wrapper)).toContain(
        'Not imported, because they choose the code or checkpoint the run uses: Registration modules, Resume checkpoint.',
      );
      expect(fieldValue(wrapper, 'epochs')).toBe('33');
      expect(fieldValue(wrapper, 'resume')).toBe('');
    } finally {
      fixture.wrapper.unmount();
      fixture.session.detach();
    }
  });
});
