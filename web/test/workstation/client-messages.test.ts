// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import ts from 'typescript';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { trainingConfigSchema, trainingDefaults } from '../../shared/schemas/training-request';
import { daemonCredentialSchema } from '../../shared/schemas/daemon-connection';
import { useClientMessages } from '../../app/composables/useClientMessages';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import { clientMessages, translateClientMessage } from '../../app/i18n/client-messages';
import type { WorkstationLocale } from '../../app/i18n/core';

describe('client-owned diagnostic presentation', () => {
  it('keeps English contracts and unknown authoritative details intact', () => {
    for (const raw of Object.values(clientMessages.en)) {
      expect(translateClientMessage('en', raw)).toBe(raw);
      expect(translateClientMessage('vi', raw)).not.toBe(raw);
    }
    for (const raw of [
      '/host/Invalid run identity/checkpoint.pt',
      'daemon: Invalid cursor',
      'Invalid cursor\n',
      'backend error 東京',
      'Too small: expected number to be >=/private/path',
      'Daemon request failed (secret)',
      'Too big: expected string to have <=9999999999999999999999999999999999999 characters',
    ])
      expect(translateClientMessage('vi', raw)).toBe(raw);
  });

  it('formats bounded Zod constraints at display without changing shared schemas', () => {
    const cases = [
      z.string().min(2).safeParse(''),
      z.string().max(2).safeParse('long'),
      z.array(z.string()).min(2).safeParse([]),
      z.array(z.string()).max(1).safeParse(['a', 'b']),
      z.number().min(-1).safeParse(-2),
      z.number().max(2).safeParse(3),
      z.number().positive().safeParse(0),
      z.number().lt(5).safeParse(5),
      z.number().int().safeParse(1.5),
      z.number().safeParse(NaN),
      daemonCredentialSchema.safeParse({ token: '' }),
      trainingConfigSchema.safeParse({ ...trainingDefaults, batch_size: 0 }),
    ];
    for (const result of cases) {
      expect(result.success).toBe(false);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        const original = issue.message;
        expect(translateClientMessage('vi', original)).not.toBe(original);
        expect(issue.message).toBe(original);
        expect(translateClientMessage('en', original)).toBe(original);
      }
    }
    expect(
      translateClientMessage('vi', 'Too small: expected number to be >=-1000000000000'),
    ).toContain('-1000000000000');
    expect(translateClientMessage('vi', 'Daemon request failed (409)')).toBe(
      'Yêu cầu daemon thất bại (409)',
    );
  });

  it('translates already-stored diagnostics reactively without changing their source', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const raw = shallowRef('Credential expired or rejected; enter it again.');
    const Consumer = defineComponent({
      setup() {
        const { clientMessage } = useClientMessages();
        return () => h('p', clientMessage(raw.value));
      },
    });
    const Provider = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(Consumer);
      },
    });
    const wrapper = mount(Provider);
    expect(wrapper.text()).toBe(raw.value);
    locale.value = 'vi';
    await nextTick();
    expect(wrapper.text()).toBe('Thông tin xác thực đã hết hạn hoặc bị từ chối; nhập lại.');
    expect(raw.value).toBe('Credential expired or rejected; enter it again.');
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toBe(raw.value);
    wrapper.unmount();
  });

  it('covers every fixed library Error/fail diagnostic and message property', () => {
    const directory = resolve('app/lib');
    const missing: string[] = [];
    for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(`${directory}/${file}`, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function check(node: ts.Node): void {
        if (
          ts.isStringLiteral(node) &&
          node.text &&
          translateClientMessage('vi', node.text) === node.text
        )
          missing.push(`${file}: ${node.text}`);
        else if (ts.isConditionalExpression(node)) {
          check(node.whenTrue);
          check(node.whenFalse);
        }
      }
      function visit(node: ts.Node): void {
        if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(source))) {
          const args = node.arguments;
          const message =
            args?.[
              node.expression.getText(source) === 'Error' ||
              node.expression.getText(source) === 'RangeError' ||
              node.expression.getText(source) === 'AdoptionError'
                ? 0
                : 1
            ];
          if (message) check(message);
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 'fail' &&
          node.arguments[0]
        )
          check(node.arguments[0]);
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'message')
          check(node.initializer);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it('covers fixed messages in the workstation shared request schemas', () => {
    const directory = resolve('shared/schemas');
    const missing: string[] = [];
    for (const file of [
      'daemon-connection.ts',
      'training-request.ts',
      'result-request.ts',
      'adoption-request.ts',
      'storage-mapping.ts',
    ]) {
      const source = ts.createSourceFile(
        file,
        readFileSync(`${directory}/${file}`, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node): void {
        // Schema diagnostic/prose literals, not schema values, identifiers or regexes.
        if (
          ts.isStringLiteral(node) &&
          /^[A-Z][A-Za-z]+ .*\.$/.test(node.text) &&
          translateClientMessage('vi', node.text) === node.text
        )
          missing.push(`${file}: ${node.text}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
