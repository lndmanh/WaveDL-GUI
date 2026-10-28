// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, shallowRef, watch } from 'vue';
import { useForm } from 'vee-validate';
import { describe, expect, it, vi } from 'vitest';
import StorageMappingFields from '../../app/components/project/StorageMappingFields.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ResultOperationForm from '../../app/components/results/ResultOperationForm.vue';
import TrainingPresets from '../../app/components/project/TrainingPresets.vue';
import { storageMapSchema } from '../../shared/schemas/storage-mapping';
import {
  trainingDefaults,
  trainingRequestSchema,
  type TrainingRequest,
} from '../../shared/schemas/training-request';
import { inferenceDefaults, resultRequestSchema } from '../../shared/schemas/result-request';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ArtifactClient } from '../../app/lib/artifact-client';
import { ProjectPlan } from '../../app/lib/project-plan';
import { ResultOperations } from '../../app/lib/result-operations';
import { trainingYaml } from '../../app/lib/training-export';

const mappings = [{ host_root: '/data', execution_root: '/mounted/data' }];
const sourceRun = '11111111-1111-4111-8111-111111111111';
const ids = {
  plan_id: '22222222-2222-4222-8222-222222222222',
  run_id: '33333333-3333-4333-8333-333333333333',
  request_id: '44444444-4444-4444-8444-444444444444',
};
function draft(): TrainingRequest {
  return trainingRequestSchema.parse({
    backend: 'slurm',
    operation: 'train',
    config: { ...trainingDefaults, data_path: '/data/test.npz' },
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  });
}
async function setup() {
  const bytes = new TextEncoder().encode(JSON.stringify({ schema_version: 1, kind: 'best' }));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const bodies: string[] = [];
  const keys: Array<string | null> = [];
  const json = (body: object) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/health')
      return json({ daemon_id: 'd', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });
    if (path === '/api/browse/resolve')
      return json({
        root: 'data',
        relative_path: 'test.npz',
        kind: 'file',
        path: '/data/test.npz',
      });
    if (path.endsWith('/artifacts'))
      return json({
        generations: [
          {
            generation: 'gen-000001',
            attempt: 1,
            step: 5,
            files: { 'checkpoint_selection.json': { size: bytes.length, sha256: hash } },
          },
        ],
      });
    if (path.endsWith('checkpoint_selection.json'))
      return new Response(bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.length),
        },
      });
    if (path === '/api/runs/plan') {
      bodies.push(String(init?.body));
      keys.push(new Headers(init?.headers).get('Idempotency-Key'));
      return json({ ...ids, preview: {} });
    }
    throw new Error(`Unexpected route ${path}`);
  });
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher,
  });
  await session.connect('token');
  const catalog = new CatalogApi(session);
  const data = await catalog.resolve('data', 'test.npz');
  const model = await catalog.selectCustomModel(draft().config.model ?? 'cnn');
  const metadata = (await new ArtifactClient(session).list(sourceRun))[0];
  if (!metadata) throw new Error('Missing source');
  return { session, data, model, metadata, bodies, keys, fetcher };
}

describe('explicit storage mapping authoring', () => {
  it('registers only actual mapping leaves in the parent form and removes/reindexes rows without stale values', async () => {
    let getValues = () => draft();
    let getErrors = () => '';
    let validateDraft = async () => false;
    const host = defineComponent({
      setup() {
        const { values, errors, validate, setFieldValue } = useForm<TrainingRequest>({
          initialValues: {
            ...draft(),
            storage_map: [
              { host_root: '/first', execution_root: '/mounted/first' },
              { host_root: '/second', execution_root: '/mounted/second' },
              { host_root: '/third', execution_root: '/mounted/third' },
            ],
          },
          validationSchema: trainingRequestSchema,
        });
        getValues = () => values;
        getErrors = () => JSON.stringify(errors.value);
        validateDraft = async () => (await validate()).valid;
        return () =>
          h(StorageMappingFields, {
            mappings: values.storage_map,
            backend: values.backend,
            disabled: false,
            onUpdate: (value) => setFieldValue('storage_map', value),
          });
      },
    });
    const wrapper = mount(host);
    await flushPromises();
    const infoLabels = wrapper
      .findAll('button')
      .map((button) => button.attributes('aria-label') ?? '');
    expect(infoLabels).toContain(
      'Mapping details: Host roots belong to the daemon host; execution roots belong to the selected Python execution environment. Mapping only rewrites paths lexically: it does not upload files, mount storage, resolve symlinks or verify access. Configure storage and site policy outside this form.',
    );
    expect(infoLabels).toContain(
      'Interpreter path details: The interpreter path is an execution-realm path, not a host path to remap. Enter only mappings you explicitly configured; dataset and other draft paths are never changed by this editor.',
    );
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove mapping 1')
      ?.trigger('click');
    await flushPromises();
    expect(getValues().storage_map).toEqual([
      { host_root: '/second', execution_root: '/mounted/second' },
      { host_root: '/third', execution_root: '/mounted/third' },
    ]);
    await wrapper.get('input[name="storage_map[0].host_root"]').setValue('/second/../escape');
    expect(wrapper.get('input[name="storage_map[0].host_root"]').attributes('aria-invalid')).toBe(
      'true',
    );
    expect(await validateDraft()).toBe(false);
    expect(getErrors()).toContain('storage_map');
    await wrapper.get('input[name="storage_map[0].host_root"]').setValue('/second');
    expect(await validateDraft()).toBe(true);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove mapping 1')
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove mapping 1')
      ?.trigger('click');
    await flushPromises();
    expect(getValues().storage_map).toEqual([]);
    expect(wrapper.findAll('input')).toHaveLength(0);
    expect(await validateDraft()).toBe(true);
    wrapper.unmount();
  });

  it('integrates with both real forms, preserves mappings through presets/reset, and renders configured rows with unique IDs', async () => {
    const i18n = createTestI18n('en');
    const fetcher = vi.fn(async () => {
      throw new Error('Disconnected');
    });
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher,
    });
    const host = defineComponent({
      setup: () => () =>
        h('main', [
          h(ProjectContainer, { session }),
          h(ResultOperationForm, { session, artifacts: [] }),
        ]),
    });
    const wrapper = mount(host, undefined, i18n);
    await flushPromises();
    const editors = wrapper.findAllComponents(StorageMappingFields);
    expect(editors).toHaveLength(2);
    expect(editors[0]?.props('mappings')).toBeUndefined();
    expect(editors[1]?.props('mappings')).toEqual([]);
    for (const editor of editors) {
      const toggle = editor.get('button[data-slot="collapsible-trigger"]');
      if (toggle.attributes('aria-expanded') === 'false') await toggle.trigger('click');
      await editor
        .findAll('button')
        .find((button) => button.text() === 'Add mapping')
        ?.trigger('click');
      await editor.get('input[name$="host_root"]').setValue('/data');
      await editor.get('input[name$="execution_root"]').setValue('/mounted/data');
      expect(editor.props('mappings')).toEqual(mappings);
    }
    const ids = wrapper.findAll('input[id*="-storage-"]').map((input) => input.attributes('id'));
    expect(new Set(ids).size).toBe(4);
    wrapper.getComponent(TrainingPresets).vm.$emit('apply', { epochs: 100 });
    await nextTick();
    expect(editors[0]?.props('mappings')).toEqual(mappings);
    const reset = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reset training defaults');
    if (!reset) throw new Error('Missing reset action');
    await reset.trigger('click');
    const confirm = wrapper.findAll('button').find((button) => button.text() === 'Confirm reset');
    if (!confirm) throw new Error('Missing confirmation');
    await confirm.trigger('click');
    expect(editors[0]?.props('mappings')).toEqual(mappings);
    const calls = fetcher.mock.calls.length;
    i18n.global.locale.value = 'vi';
    await nextTick();
    await flushPromises();
    expect(fetcher.mock.calls).toHaveLength(calls);
    expect(
      wrapper.findAll('input[id*="-storage-"]').map((input) => input.attributes('id')),
    ).toEqual(ids);
    wrapper.unmount();
    session.detach();
  });

  it('mounts without introducing storage_map, authors blank pairs and local guidance, and keeps coexisting IDs unique across language changes', async () => {
    const i18n = createTestI18n('en');
    const snapshots: TrainingRequest[] = [];
    const Form = defineComponent({
      setup() {
        const { values, setFieldValue } = useForm<TrainingRequest>({
          initialValues: draft(),
          validationSchema: trainingRequestSchema,
        });
        snapshots.push(values);
        return () =>
          h(StorageMappingFields, {
            mappings: values.storage_map,
            backend: 'local',
            disabled: false,
            onUpdate: (value) => setFieldValue('storage_map', value),
          });
      },
    });
    const host = defineComponent({
      setup: () => () => h('main', [h(Form), h(Form)]),
    });
    const wrapper = mount(host, undefined, i18n);
    await flushPromises();
    expect(snapshots.every((value) => !Object.hasOwn(value, 'storage_map'))).toBe(true);
    for (const editor of wrapper.findAllComponents(StorageMappingFields)) {
      const toggle = editor.get('button[data-slot="collapsible-trigger"]');
      if (toggle.attributes('aria-expanded') === 'false') await toggle.trigger('click');
      await editor
        .findAll('button')
        .find((button) => button.text() === 'Add mapping')
        ?.trigger('click');
    }
    expect(
      snapshots.every(
        (value) =>
          value.storage_map?.[0]?.host_root === '' && value.storage_map[0].execution_root === '',
      ),
    ).toBe(true);
    expect(wrapper.text()).toContain('local backend refuses');
    const ids = wrapper.findAll('input').map((input) => input.attributes('id'));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(wrapper.get(`label[for="${id}"]`).text()).not.toBe('');
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(wrapper.findAll('input').map((input) => input.attributes('id'))).toEqual(ids);
    expect(wrapper.text()).toContain('Gốc máy chủ');
    expect(snapshots[0]?.config.data_path).toBe('/data/test.npz');
    wrapper.unmount();
  });

  it('shows root, duplicate and platform errors, allows 32 rows, and never guesses paths or silently clears maps on backend changes', async () => {
    const value = shallowRef(mappings);
    const backend = shallowRef('slurm');
    const host = defineComponent({
      setup() {
        return () =>
          h(StorageMappingFields, {
            mappings: value.value,
            backend: backend.value,
            disabled: false,
            onUpdate: (next) => {
              value.value = next;
            },
          });
      },
    });
    const wrapper = mount(host);
    expect(wrapper.get('button[data-slot="collapsible-trigger"]').attributes('aria-expanded')).toBe(
      'true',
    );
    await wrapper.get('input[name$="host_root"]').setValue('/data/../escape');
    expect(wrapper.get('input[name$="host_root"]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('parent traversal');
    value.value = [{ host_root: '/data', execution_root: 'C:/data' }];
    await nextTick();
    expect(wrapper.text()).toContain('same path platform');
    value.value = [...mappings, ...mappings];
    await nextTick();
    expect(wrapper.text()).toContain('unique host roots');
    expect(
      storageMapSchema.safeParse([{ host_root: '/' + 'x'.repeat(8192), execution_root: '/data' }])
        .success,
    ).toBe(false);
    value.value = Array.from({ length: 32 }, (_, index) => ({
      host_root: `/host/${index}`,
      execution_root: `/execution/${index}`,
    }));
    await nextTick();
    expect(wrapper.findAll('input')).toHaveLength(64);
    expect(wrapper.findAll('button').at(-1)?.attributes('disabled')).toBeDefined();
    backend.value = 'local';
    await nextTick();
    expect(value.value).toHaveLength(32);
    expect(wrapper.text()).toContain('local backend refuses');
    wrapper.unmount();
  });

  it('omits empty/undefined mappings from both planning bodies and preserves the unchanged retry fingerprint', async () => {
    const { session, data, model, metadata, bodies, keys } = await setup();
    const project = new ProjectPlan(session);
    const training = draft();
    project.prepare(training, data, model);
    await project.preview();
    training.storage_map = [];
    project.prepare(training, data, model);
    await project.preview();
    training.storage_map = undefined;
    project.prepare(training, data, model);
    await project.preview();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
    const results = new ResultOperations(session);
    const result = resultRequestSchema.parse({
      ...draft(),
      operation: 'test',
      config: { ...inferenceDefaults, data_path: data.path },
      checkpoint_source: { run_id: sourceRun, generation: metadata.generation },
    });
    await results.prepare(result, data, metadata);
    await results.preview();
    result.storage_map = [];
    await results.prepare(result, data, metadata);
    await results.preview();
    result.storage_map = undefined;
    await results.prepare(result, data, metadata);
    await results.preview();
    expect(keys[3]).toBe(keys[4]);
    expect(keys[4]).toBe(keys[5]);
    for (const body of bodies) expect(Object.hasOwn(JSON.parse(body), 'storage_map')).toBe(false);
    session.detach();
  });

  it('invalidates approved preview on form edits while retaining the API approval snapshot; locale changes do not request anything', async () => {
    const { session, data, model, bodies, fetcher } = await setup();
    const workflow = new ProjectPlan(session);
    const i18n = createTestI18n('en');
    const host = defineComponent({
      setup() {
        const { values, setFieldValue } = useForm<TrainingRequest>({
          initialValues: { ...draft(), storage_map: mappings },
          validationSchema: trainingRequestSchema,
        });
        watch(values, () => workflow.invalidate(), { deep: true, flush: 'sync' });
        workflow.prepare(values, data, model);
        const backend = computed(() => values.backend);
        return () =>
          h(StorageMappingFields, {
            mappings: values.storage_map,
            backend: backend.value,
            disabled: false,
            onUpdate: (value) => setFieldValue('storage_map', value),
          });
      },
    });
    const wrapper = mount(host, undefined, i18n);
    await flushPromises();
    const approved = await workflow.preview();
    const api = session.api;
    if (!api) throw new Error('No API');
    const snapshot = api.approvedRequest(approved);
    expect(snapshot.storage_map).toEqual(mappings);
    const calls = fetcher.mock.calls.length;
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(fetcher.mock.calls).toHaveLength(calls);
    expect(workflow.approved).toBe(approved);
    await wrapper.get('input[name$="execution_root"]').setValue('/new/execution');
    expect(workflow.approved).toBeNull();
    expect(api.approvedRequest(approved).storage_map).toEqual(mappings);
    expect(JSON.parse(bodies[0] ?? '{}').config.data_path).toBe('/data/test.npz');
    expect(trainingYaml({ ...draft(), storage_map: mappings })).not.toContain('storage_map');
    wrapper.unmount();
    session.detach();
  });
});
