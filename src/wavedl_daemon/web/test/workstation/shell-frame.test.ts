// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mountWithI18n as mount, createTestI18n } from './mountWithI18n';
import WorkstationShell from '../../app/components/shell/WorkstationShell.vue';
import {
  PRIMARY_WORKSTATION_SECTION_IDS,
  WORKSTATION_SECTION_IDS,
  WORKSTATION_SHELL_TEST_IDS,
  workstationNavTestId,
} from '../../app/lib/shell-test-ids';

type ShellLocale = 'en' | 'vi';

const shellProps = {
  status: 'disconnected' as const,
  section: 'experiments' as const,
  overlay: null,
};
const mountedWrappers: Array<{ unmount: () => void }> = [];
const shellStyles = readFileSync(resolve(process.cwd(), 'app/assets/css/shell.css'), 'utf8');

function mountShell(locale: ShellLocale = 'en') {
  let wrapper!: ReturnType<typeof mount>;
  wrapper = mount(
    WorkstationShell,
    {
      props: {
        ...shellProps,
        'onUpdate:overlay': (overlay: 'adopt' | null) =>
          wrapper.setProps({ overlay }),
      },
      slots: {
        default: '<p data-testid="shell-slot-content">Shell content</p>',
        adopt: '<button data-testid="adopt-slot">Adopt</button>',
      },
      attachTo: document.body,
    },
    createTestI18n(locale),
  );
  mountedWrappers.push(wrapper);
  return wrapper;
}

function dispatchWindowKey(
  key: string,
  modifiers: Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> = {},
): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...modifiers,
    }),
  );
}

function dispatchKey(target: EventTarget, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
    }),
  );
}

async function settle(): Promise<void> {
  await nextTick();
  await flushPromises();
  await nextTick();
}

function visiblePalette(): Element {
  const palette = document.body.querySelector(
    `[data-testid="${WORKSTATION_SHELL_TEST_IDS.commandPalette}"]`,
  );
  expect(palette).not.toBeNull();
  return palette as Element;
}

function visibleDialog(): Element {
  const dialog = document.body.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog as Element;
}

function injectFrameStyles(): void {
  const layoutRules = [
    shellStyles.match(/html,\s*body,\s*#__nuxt\s*\{[^}]*\}/)?.[0],
    shellStyles.match(/\.shell-ground\s*\{[^}]*\}/s)?.[0],
    shellStyles.match(/\.shell-scroll\s*\{[^}]*\}/s)?.[0],
  ];
  expect(layoutRules).toEqual([expect.any(String), expect.any(String), expect.any(String)]);
  const stylesheet = document.createElement('style');
  stylesheet.dataset.testid = 'shell-frame-styles';
  stylesheet.textContent = layoutRules.join('\n');
  document.head.append(stylesheet);
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  document.head.querySelector('[data-testid="shell-frame-styles"]')?.remove();
});

describe('workstation shell frame', () => {
  it('owns one scroll container and keeps the document outside the scroll chain', async () => {
    injectFrameStyles();
    const wrapper = mountShell();
    await settle();

    const shell = wrapper.get('[data-shell]');
    const scroll = wrapper.get('[data-shell-scroll]');
    expect(wrapper.findAll('[data-shell-scroll]')).toHaveLength(1);
    expect(wrapper.findAll('#workspace')).toHaveLength(1);
    expect(shell.classes()).toContain('overflow-hidden');
    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden');
    expect(getComputedStyle(document.body).overflow).toBe('hidden');
    expect(getComputedStyle(shell.element).overflow).toBe('hidden');
    expect(getComputedStyle(scroll.element).overflowY).toBe('auto');
    // Absolutely positioned descendants (sr-only text) must resolve against the
    // scroller, or they extend the document past the viewport.
    expect(scroll.classes()).toContain('relative');
  });

  it('uses compact, accessible header actions at 320px', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    try {
      const wrapper = mountShell();
      await settle();

      const header = wrapper.get('.shell-header');
      const status = wrapper.get('[data-testid="connection-status"]');
      const adopt = wrapper.get(`[data-testid="${workstationNavTestId('adopt')}"]`);
      expect(header.attributes('data-layout')).toBe('compact');
      expect(header.get('.shell-header-title').classes()).toContain('shell-header-title');
      expect(status.attributes('data-compact')).toBe('true');
      expect(status.attributes('aria-label')).toContain('Not connected');
      expect(status.find('.shell-status-dot').exists()).toBe(true);
      expect(status.get('span.sr-only').text()).toBe('Not connected');
      expect(adopt.attributes('data-compact')).toBe('true');
      expect(adopt.attributes('aria-label')).toBe('Adopt standalone run');
      expect(adopt.get('svg').exists()).toBe(true);
      expect(adopt.get('span.sr-only').text()).toBe('Adopt standalone run');
      expect(shellStyles).toContain('text-overflow: ellipsis;');
      expect(shellStyles).toContain('gap: 0.5rem;');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it.each([
    ['Ctrl+K', { ctrlKey: true, metaKey: false }],
    ['Cmd+K', { ctrlKey: false, metaKey: true }],
  ] as const)('opens and supports keyboard selection with %s', async (_label, modifiers) => {
    const wrapper = mountShell();
    const opener = wrapper.get(`[data-testid="${workstationNavTestId('experiments')}"]`);
    opener.element.focus();

    dispatchWindowKey('k', modifiers);
    await settle();

    const palette = visiblePalette();
    expect(palette.querySelector('h2')?.classList.contains('sr-only')).toBe(true);
    expect(shellStyles).toContain('top: clamp(4rem, 10vh, 6rem) !important;');
    expect(shellStyles).toContain('translate: -50% 0 !important;');
    const search = palette.querySelector('input');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);

    (search as HTMLInputElement).value = 'Datasets';
    search?.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    dispatchKey(search as HTMLInputElement, 'ArrowDown');
    dispatchKey(search as HTMLInputElement, 'Enter');
    await settle();

    expect(wrapper.emitted('navigate')).toContainEqual(['datasets']);
    expect(
      document.body.querySelector(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.commandPalette}"]`),
    ).toBeNull();
  });

  it('closes the command palette with Escape and restores focus to its opener', async () => {
    const wrapper = mountShell();
    const opener = wrapper.get(`[data-testid="${workstationNavTestId('experiments')}"]`);
    opener.element.focus();

    dispatchWindowKey('k', { metaKey: true });
    await settle();
    const palette = visiblePalette();
    expect(document.activeElement).toBe(palette.querySelector('input'));

    dispatchKey(document, 'Escape');
    await settle();
    expect(
      document.body.querySelector(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.commandPalette}"]`),
    ).toBeNull();
    expect(document.activeElement).toBe(opener.element);
  });

  it.each(['adopt'])(
    'keeps focus in the %s overlay and restores it on Escape',
    async (section) => {
      const wrapper = mountShell();
      const opener = wrapper.get(`[data-testid="${workstationNavTestId(section)}"]`);
      opener.element.focus();
      await opener.trigger('click');
      await settle();

      const dialog = visibleDialog();
      expect(dialog.contains(document.activeElement)).toBe(true);

      dispatchKey(document, 'Escape');
      await settle();
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener.element);
    },
  );

  it.each(['en', 'vi'] as const)('keeps stable navigation ids in the %s locale', async (locale) => {
    const wrapper = mountShell(locale);
    const navigation = wrapper.get(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.navigation}"]`);

    expect(navigation.attributes('aria-label')).toBe(locale === 'en' ? 'Sections' : 'Các mục');
    for (const section of WORKSTATION_SECTION_IDS.filter((item) => item !== 'adopt')) {
      const selector = `[data-testid="${workstationNavTestId(section)}"]`;
      expect(navigation.findAll(selector)).not.toHaveLength(0);
      if (section === 'experiments') {
        expect(navigation.get(selector).attributes('aria-label')).toBe(
          locale === 'en' ? 'Experiments' : 'Thí nghiệm',
        );
      }
    }
    expect(wrapper.findAll(`[data-testid="${workstationNavTestId('adopt')}"]`)).not.toHaveLength(0);
    for (const section of PRIMARY_WORKSTATION_SECTION_IDS) {
      expect(navigation.get(`[data-testid="${workstationNavTestId(section)}"]`).exists()).toBe(
        true,
      );
    }
  });
});
