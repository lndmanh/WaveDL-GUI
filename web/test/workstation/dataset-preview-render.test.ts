// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PreviewPlot from '../../app/components/datasets/PreviewPlot.vue';
import PreviewHeatmap from '../../app/components/datasets/PreviewHeatmap.vue';

const mocks = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn(), setData: vi.fn() }));
vi.mock('uplot', () => ({
  default: class {
    canvas: HTMLCanvasElement | null = null;
    scales = {};
    constructor(...args: unknown[]) {
      mocks.create(...args);
      const host = args[2];
      if (host instanceof HTMLDivElement) {
        this.canvas = document.createElement('canvas');
        host.append(this.canvas);
      }
    }
    destroy() {
      this.canvas?.remove();
      mocks.destroy();
    }
    setData = mocks.setData;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 640, 320),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Blob APIs are mocked here: these exercise component lifecycle, not browser downloads.
describe.each([
  { kind: 'plot', filename: 'dataset-preview.png' },
  { kind: 'heatmap', filename: 'dataset-heatmap.png' },
] as const)('$kind export lifecycle', ({ kind, filename }) => {
  function prepareExport() {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    }));
    let callback: BlobCallback | null = null;
    const serialize = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((value) => {
        callback = value;
      });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchors: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this);
    });
    const fixture = document.createElement('section');
    fixture.dataset.currentTab = 'input';
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'true');
    tab.textContent = 'Input';
    fixture.append(tab);
    document.body.append(fixture);
    const wrapper =
      kind === 'plot'
        ? mount(PreviewPlot, {
            attachTo: fixture,
            props: { title: 'Feature 0', x: [0, 1], y: [1, null] },
          })
        : mount(PreviewHeatmap, {
            attachTo: fixture,
            props: {
              title: 'Correlation',
              matrix: [
                [-1, null],
                [0, 1],
              ],
            },
          });
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const href = window.location.href;
    let mounted = true;
    function unmount() {
      if (!mounted) return;
      wrapper.unmount();
      mounted = false;
    }
    return {
      wrapper,
      fixture,
      tab,
      serialize,
      create,
      revoke,
      click,
      anchors,
      push,
      replace,
      href,
      unmount,
      complete(blob: Blob | null) {
        if (!callback) throw new Error('Export did not request canvas serialization');
        callback(blob);
      },
      async trigger() {
        // onMounted creates uPlot; Vue must patch the initially disabled button.
        await nextTick();
        const button = wrapper.findAll('button').find((item) => item.text() === 'Export PNG');
        if (!button) throw new Error('Missing rendered Export PNG button');
        expect(button.attributes('disabled')).toBeUndefined();
        await button.trigger('click');
      },
      cleanup() {
        unmount();
        fixture.remove();
      },
    };
  }

  it('exports without changing chart DOM, history or surrounding sentinels', async () => {
    const exportState = prepareExport();
    try {
      await nextTick();
      const canvas = exportState.wrapper.get('canvas').element;
      const before = canvas.outerHTML;
      await exportState.trigger();
      expect(exportState.wrapper.get('[role="status"]').text()).toBe('Preparing PNG export…');
      const pendingButton = exportState.wrapper
        .findAll('button')
        .find((item) => item.text() === 'Export PNG');
      expect(pendingButton?.attributes('disabled')).toBeDefined();
      await pendingButton?.trigger('click');
      expect(exportState.serialize).toHaveBeenCalledOnce();
      expect(exportState.serialize.mock.instances[0]).toBe(canvas);
      expect(exportState.create).not.toHaveBeenCalled();
      const blob = new Blob(['mock canvas bytes'], { type: 'image/png' });
      exportState.complete(blob);
      expect(exportState.create).toHaveBeenCalledExactlyOnceWith(blob);
      expect(exportState.click).toHaveBeenCalledOnce();
      expect(exportState.anchors[0]?.download).toBe(filename);
      expect(exportState.anchors[0]?.href).toBe('blob:preview-export');
      expect(exportState.anchors[0]?.isConnected).toBe(false);
      expect(exportState.revoke).not.toHaveBeenCalled();
      {
        await nextTick();
        expect(exportState.wrapper.get('[role="status"]').text()).toContain('PNG export requested');
        expect(exportState.wrapper.text()).toContain('browser controls where it is saved');
        expect(exportState.wrapper.text()).not.toContain('downloaded');
        vi.advanceTimersByTime(999);
        expect(exportState.revoke).not.toHaveBeenCalled();
      }
      vi.runOnlyPendingTimers();
      expect(exportState.revoke).toHaveBeenCalledExactlyOnceWith('blob:preview-export');
      expect(exportState.wrapper.get('canvas').element).toBe(canvas);
      expect(canvas.outerHTML).toBe(before);
      expect(exportState.tab.isConnected).toBe(true);
      expect(exportState.fixture.dataset.currentTab).toBe('input');
      expect(exportState.tab.getAttribute('aria-selected')).toBe('true');
      expect(exportState.wrapper.emitted('navigate')).toBeUndefined();
      expect(exportState.wrapper.emitted('update:modelValue')).toBeUndefined();
      expect(exportState.push).not.toHaveBeenCalled();
      expect(exportState.replace).not.toHaveBeenCalled();
      expect(window.location.href).toBe(exportState.href);
    } finally {
      exportState.cleanup();
    }
  });

  it.each(['null blob', 'unmounted'] as const)(
    'refuses a late %s callback without download or live DOM mutation',
    async (failure) => {
      const exportState = prepareExport();
      try {
        await exportState.trigger();
        expect(exportState.serialize).toHaveBeenCalledOnce();
        if (failure === 'unmounted') exportState.unmount();
        const before = document.body.innerHTML;
        exportState.complete(
          failure === 'null blob' ? null : new Blob(['late bytes'], { type: 'image/png' }),
        );
        await nextTick();
        vi.runOnlyPendingTimers();
        expect(exportState.create).not.toHaveBeenCalled();
        expect(exportState.click).not.toHaveBeenCalled();
        expect(exportState.revoke).not.toHaveBeenCalled();
        if (failure === 'null blob')
          expect(exportState.wrapper.get('[role="status"]').text()).toContain(
            'could not be prepared',
          );
        else expect(document.body.innerHTML).toBe(before);
        expect(exportState.tab.getAttribute('aria-selected')).toBe('true');
        expect(exportState.fixture.dataset.currentTab).toBe('input');
        expect(exportState.push).not.toHaveBeenCalled();
        expect(exportState.replace).not.toHaveBeenCalled();
        expect(window.location.href).toBe(exportState.href);
      } finally {
        exportState.cleanup();
      }
    },
  );

  {
    it.each(['serialization', 'URL creation', 'download click'] as const)(
      'reports a sanitized %s failure and permits retry',
      async (failure) => {
        const exportState = prepareExport();
        const privateError = new DOMException('private canvas/browser detail', 'SecurityError');
        try {
          if (failure === 'serialization')
            exportState.serialize.mockImplementationOnce(() => {
              throw privateError;
            });
          else if (failure === 'URL creation')
            exportState.create.mockImplementationOnce(() => {
              throw privateError;
            });
          else
            exportState.click.mockImplementationOnce(() => {
              throw privateError;
            });
          await exportState.trigger();
          if (failure !== 'serialization') exportState.complete(new Blob(['png']));
          await nextTick();
          expect(exportState.wrapper.get('[role="status"]').text()).toContain(
            failure === 'serialization' ? 'could not be prepared' : 'could not be requested',
          );
          expect(exportState.wrapper.text()).not.toContain('private canvas/browser detail');
          expect(exportState.wrapper.text()).not.toContain('PNG export requested');
          expect(exportState.revoke).not.toHaveBeenCalled();
          vi.advanceTimersByTime(1000);
          if (failure === 'download click')
            expect(exportState.revoke).toHaveBeenCalledWith('blob:preview-export');
          else expect(exportState.revoke).not.toHaveBeenCalled();
          await exportState.trigger();
          exportState.complete(new Blob(['retry png']));
          await nextTick();
          expect(exportState.wrapper.get('[role="status"]').text()).toContain(
            'PNG export requested',
          );
          exportState.unmount();
          vi.advanceTimersByTime(1000);
          expect(exportState.revoke).toHaveBeenCalledWith('blob:preview-export');
        } finally {
          exportState.cleanup();
        }
      },
    );
  }

  it('ignores serialization completed after preview data replacement', async () => {
    const exportState = prepareExport();
    try {
      await exportState.trigger();
      if (kind === 'plot') await exportState.wrapper.setProps({ x: [2, 3], y: [3, 4] });
      else await exportState.wrapper.setProps({ matrix: [[1, 2]] });
      const before = document.body.innerHTML;
      exportState.complete(new Blob(['old preview']));
      await nextTick();
      expect(exportState.create).not.toHaveBeenCalled();
      expect(exportState.click).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toBe(before);
      await exportState.trigger();
      exportState.complete(new Blob(['current preview']));
      await nextTick();
      expect(exportState.click).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1000);
    } finally {
      exportState.cleanup();
    }
  });
  it('ignores serialization after title or view changes', async () => {
    const exportState = prepareExport();
    try {
      await exportState.trigger();
      await exportState.wrapper.setProps({ title: 'Updated title' });
      exportState.complete(new Blob(['old title']));
      expect(exportState.click).not.toHaveBeenCalled();
      if (kind === 'heatmap') {
        await exportState.trigger();
        await exportState.wrapper.get('canvas').trigger('keydown', { key: '+' });
        exportState.complete(new Blob(['old zoom']));
        expect(exportState.click).not.toHaveBeenCalled();
        await exportState.trigger();
        await exportState.wrapper.setProps({ correlation: true });
        exportState.complete(new Blob(['old scale']));
        expect(exportState.click).not.toHaveBeenCalled();
      }
    } finally {
      exportState.cleanup();
    }
  });
});
describe('interactive preview lifecycle', () => {
  it('replaces plot data and disposes external uPlot on unmount', async () => {
    const wrapper = mount(PreviewPlot, { props: { title: 'Feature 0', x: [0, 1], y: [1, null] } });
    expect(mocks.create).toHaveBeenCalledOnce();
    await wrapper.setProps({ x: [2, 3], y: [0, 1] });
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    await wrapper.get('button').trigger('click');
    expect(mocks.setData).toHaveBeenCalledWith([
      [2, 3],
      [0, 1],
    ]);
    wrapper.unmount();
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
  it('scatter retains points and never connects observations with a line', () => {
    const wrapper = mount(PreviewPlot, {
      props: { title: 'Scatter', x: [0, 1], y: [2, 3], scatter: true },
    });
    const options = mocks.create.mock.calls[0]?.[0];
    expect(options.series[1].points.show).toBe(true);
    expect(options.series[1].paths()).toBeNull();
    wrapper.unmount();
  });
  it('heatmap supports keyboard pan/zoom and never creates a filesystem URL', async () => {
    const fills = vi.fn();
    const context = { clearRect: vi.fn(), fillRect: fills, fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context);
    const wrapper = mount(PreviewHeatmap, {
      props: {
        title: 'Correlation',
        matrix: [
          [-1, null],
          [0, 1],
        ],
      },
    });
    expect(fills).toHaveBeenCalledTimes(4);
    const canvas = wrapper.get('canvas');
    expect(canvas.attributes('tabindex')).toBe('0');
    await canvas.trigger('keydown', { key: '+' });
    await canvas.trigger('keydown', { key: 'ArrowRight' });
    await canvas.trigger('keydown', { key: '0' });
    expect(fills).toHaveBeenCalledTimes(16);
    expect(wrapper.find('a').exists()).toBe(false);
    wrapper.unmount();
  });
  it('clears hover details when the matrix, scale, or view is reset', async () => {
    const wrapper = mount(PreviewHeatmap, {
      props: {
        title: 'Correlation',
        matrix: [
          [0.25, -1],
          [0, 1],
        ],
        correlation: true,
      },
    });
    const canvas = wrapper.get('canvas');
    await canvas.trigger('pointermove', { clientX: 100, clientY: 40 });
    expect(wrapper.text()).toContain('Row 0, column 0: 0.25');
    await wrapper.setProps({ matrix: [[0.99]] });
    expect(wrapper.text()).not.toContain('Row 0, column 0: 0.25');
    await canvas.trigger('pointermove', { clientX: 100, clientY: 40 });
    expect(wrapper.text()).toContain('Row 0, column 0: 0.99');
    await wrapper.setProps({ correlation: false });
    expect(wrapper.text()).not.toContain('Row 0, column 0: 0.99');
    await canvas.trigger('pointermove', { clientX: 100, clientY: 40 });
    expect(wrapper.text()).toContain('Row 0, column 0: 0.99');
    await canvas.trigger('keydown', { key: '0' });
    expect(wrapper.text()).not.toContain('Row 0, column 0: 0.99');
    wrapper.unmount();
  });
});
