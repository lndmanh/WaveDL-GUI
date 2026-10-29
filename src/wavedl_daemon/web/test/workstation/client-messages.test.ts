// @vitest-environment happy-dom
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it, afterEach } from 'vitest';
import { z } from 'zod';
import enClientErrors from '../../app/i18n/locales/en/client-errors.json';
import viClientErrors from '../../app/i18n/locales/vi/client-errors.json';
import {
  clientError,
  configureValidationLocale,
  translateClientDiagnostic,
} from '../../app/i18n/client-messages';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import { useClientMessages } from '../../app/composables/useClientMessages';
import { daemonCredentialSchema } from '../../shared/schemas/daemon-connection';
import { trainingConfigSchema, trainingDefaults } from '../../shared/schemas/training-request';
import { mountWithI18n as mount } from './mountWithI18n';
import type { WorkstationLocale } from '../../app/i18n/core';

function placeholders(message: string): string[] {
  return [
    ...new Set(
      [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1] ?? ''),
    ),
  ]
    .filter(Boolean)
    .sort();
}

afterEach(() => configureValidationLocale('en'));

describe('client-owned coded diagnostics', () => {
  it('keeps locale keys and named placeholders in exact parity', () => {
    expect(Object.keys(enClientErrors).sort()).toEqual(Object.keys(viClientErrors).sort());
    for (const [key, english] of Object.entries(enClientErrors)) {
      const vietnamese = Object.entries(viClientErrors).find(([viKey]) => viKey === key)?.[1];
      expect(vietnamese).toBeDefined();
      if (vietnamese) expect(placeholders(vietnamese)).toEqual(placeholders(english));
    }
  });

  it('preserves Error.message in English while translating only coded client diagnostics', () => {
    const failure = clientError('daemonRequestFailed', { status: 409 });
    expect(failure.message).toBe('Daemon request failed (409)');
    expect(translateClientDiagnostic('en', failure)).toBe(failure.message);
    expect(translateClientDiagnostic('vi', failure)).toBe('Yêu cầu daemon thất bại (409)');

    const error = clientError('invalidRunIdentity');
    expect(error.message).toBe('Invalid run identity');
    expect(translateClientDiagnostic('vi', error)).toBe('Định danh tác vụ không hợp lệ');
  });

  it('never reverse-matches English prose or translates authoritative details', () => {
    for (const raw of [
      'Invalid run identity',
      '/host/Invalid run identity/checkpoint.pt',
      'daemon: Invalid cursor',
      'Invalid cursor\n',
      'backend error 東京',
      'Daemon request failed (secret)',
    ])
      expect(translateClientDiagnostic('vi', raw)).toBe(raw);

    expect(translateClientDiagnostic('vi', new Error('backend error 東京'))).toBe(
      'backend error 東京',
    );
  });

  it('uses Zod 4 built-in locales and retains product-defined custom messages', () => {
    configureValidationLocale('en');
    const builtInEnglish = z.string().min(2).safeParse('').error?.issues[0]?.message;
    expect(builtInEnglish).toBe('Too small: expected string to have >=2 characters');
    const credentialEnglish = daemonCredentialSchema.safeParse({ token: '' }).error?.issues[0]
      ?.message;
    expect(credentialEnglish).toBe('Paste your access key.');
    const cvEnglish = trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 1 }).error
      ?.issues[0]?.message;
    expect(cvEnglish).toBe('Cross-validation requires at least two folds.');

    configureValidationLocale('vi');
    const builtInVietnamese = z.string().min(2).safeParse('').error?.issues[0]?.message;
    expect(builtInVietnamese).toBe('Quá nhỏ: mong đợi string có >=2 ký tự');
    const credentialVietnamese = daemonCredentialSchema.safeParse({ token: '' }).error?.issues[0]
      ?.message;
    expect(credentialVietnamese).toBe('Dán khóa truy cập của bạn.');
    const cvVietnamese = trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 1 }).error
      ?.issues[0]?.message;
    expect(cvVietnamese).toBe('Kiểm định chéo cần ít nhất hai fold.');
  });

  it('translates a stored diagnostic reactively without changing its source Error', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const diagnostic = shallowRef(clientError('credentialRequired'));
    const Consumer = defineComponent({
      setup() {
        const { clientMessage } = useClientMessages();
        return () => h('p', clientMessage(diagnostic.value));
      },
    });
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(Consumer);
      },
    });
    const wrapper = mount(Provider);
    expect(wrapper.text()).toBe('Paste your access key.');
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.text()).toBe('Dán khóa truy cập của bạn.');
    expect(diagnostic.value.message).toBe('Paste your access key.');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toBe(diagnostic.value.message);
    expect(document.cookie).toBe('');
    wrapper.unmount();
  });
});
