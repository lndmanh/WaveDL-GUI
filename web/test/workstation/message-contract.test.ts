import { describe, expect, it } from 'vitest';
import { messages } from '../../app/i18n/messages';
import {
  dynamicMessageKeys,
  runStateMessageKeys,
  runOperationMessageKeys,
  runtimeValues,
  runtimeValueMessageKeys,
} from '../../app/i18n/dynamic-keys';
import { RUN_STATES } from '../../app/lib/daemon-api';
import modelSourceHashes from '../../app/i18n/model-source-hashes.json';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import {
  baseParse,
  parserOptions,
  NodeTypes,
  type RootNode,
  type TemplateChildNode,
} from '@vue/compiler-dom';

const app = resolve('app');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|vue)$/.test(path) ? [path] : [];
  });
}

function literalTranslationKeys(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = new Set(['t', 'fieldMessage', 'runMessage']);
  const keys: string[] = [];
  function inspectKey(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) keys.push(node.text);
    else if (ts.isConditionalExpression(node)) {
      inspectKey(node.whenTrue);
      inspectKey(node.whenFalse);
    } else if (ts.isParenthesizedExpression(node)) inspectKey(node.expression);
  }
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      (names.has(node.expression.getText(ast)) || /\.t$/.test(node.expression.getText(ast)))
    ) {
      const key = node.arguments[0];
      if (key) inspectKey(key);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return keys;
}

function storedTranslationKeys(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) {
      if (
        /^(catalog|cv|datasets|models|project|results|runs|shell|storage|training|clientErrors)\.[A-Za-z0-9_.]+$/.test(
          node.text,
        )
      )
        keys.push(node.text);
      if (Object.hasOwn(messages.en.clientErrors, node.text))
        keys.push(`clientErrors.${node.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return keys;
}

function componentExpressions(source: string, file = '<fixture>'): string[] {
  const { descriptor } = parse(source);
  const expressions = [descriptor.script?.content ?? '', descriptor.scriptSetup?.content ?? ''];
  function visit(node: RootNode | TemplateChildNode): void {
    if (node.type === NodeTypes.INTERPOLATION && node.content.type === NodeTypes.SIMPLE_EXPRESSION)
      expressions.push(node.content.content);
    if (node.type === NodeTypes.ELEMENT)
      for (const prop of node.props)
        if (prop.type === NodeTypes.DIRECTIVE && prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION)
          expressions.push(prop.exp.content);
    if ('children' in node)
      for (const child of node.children) if (typeof child !== 'string') visit(child);
  }
  if (descriptor.template) {
    try {
      visit(baseParse(descriptor.template.content, parserOptions));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return expressions;
}

export function flattenMessages(tree: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      return typeof value === 'string'
        ? [[fullKey, value]]
        : Object.entries(flattenMessages(value, fullKey));
    }),
  );
}

function validMessageKey(key: string): boolean {
  return key
    .split('.')
    .every(
      (segment) =>
        /^[a-z][A-Za-z0-9_]*$/.test(segment) &&
        !/^[a-z][A-Z]/.test(segment) &&
        segment.length <= 32,
    );
}

describe('message contracts', () => {
  it('leaves the dataset label to the InfoChip without repeating it in the summary', () => {
    for (const locale of ['en', 'vi'] as const) {
      expect(messages[locale].project.datasetSelectionSummary).toMatch(/^\{path\}\{daemon\}\./);
      expect(messages[locale].project.datasetSelectionSummary).not.toMatch(
        /^(Dataset|Bộ dữ liệu):/,
      );
    }
  });

  it('covers every closed state/operation/runtime enum and every derived key in both languages', () => {
    expect(Object.keys(runStateMessageKeys).sort()).toEqual([...RUN_STATES].sort());
    expect(Object.keys(runOperationMessageKeys).sort()).toEqual(['plot', 'test', 'train']);
    expect(Object.keys(runtimeValueMessageKeys).sort()).toEqual([...runtimeValues].sort());
    for (const locale of ['en', 'vi'] as const) {
      const catalog = flattenMessages(messages[locale]);
      expect(
        [...new Set(dynamicMessageKeys)].filter(
          (key) => !key.startsWith('models.') && !Object.hasOwn(catalog, key),
        ),
      ).toEqual([]);
    }
  });
  it('resolves every literal translation call in scripts and SFC template expressions', () => {
    const en = flattenMessages(messages.en);
    const missing: string[] = [];
    for (const file of sourceFiles(app)) {
      const source = readFileSync(file, 'utf8');
      const expressions = file.endsWith('.vue') ? componentExpressions(source, file) : [source];
      for (const expression of expressions)
        for (const key of [
          ...literalTranslationKeys(expression, file),
          ...storedTranslationKeys(expression, file),
        ])
          if (
            !Object.hasOwn(en, key) &&
            !Object.hasOwn(flattenMessages(messages.vi.models, 'models'), key)
          )
            missing.push(`${relative(app, file)}: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('inspects script and template calls rather than incidental string contents', () => {
    expect(
      literalTranslationKeys(`t('a'); const prose = "t('notACall')"; t(dynamic);`, 'x.ts'),
    ).toEqual(['a']);
    expect(literalTranslationKeys(`t(condition ? 'a' : 'b')`, 'x.ts')).toEqual(['a', 'b']);
    expect(
      componentExpressions(
        `<script setup>t('a')</script><template><p :title="t('b')">{{ t('c') }}</p></template>`,
      ).flatMap((source) => literalTranslationKeys(source, 'x.ts')),
    ).toEqual(['a', 'b', 'c']);
  });
  it('has identical locale keys and named placeholder sets', () => {
    const en = flattenMessages(messages.en);
    const vi = flattenMessages(messages.vi);
    expect([...Object.keys(en), ...Object.keys(vi)].filter((key) => !validMessageKey(key))).toEqual(
      [],
    );
    expect(Object.keys(en).sort()).toEqual(
      Object.keys(vi)
        .filter((key) => !key.startsWith('models.'))
        .sort(),
    );
    expect(Object.keys(messages.vi.models).sort()).toEqual(Object.keys(modelSourceHashes).sort());
    expect(Object.hasOwn(messages.en, 'models')).toBe(false);
    expect(Object.keys(flattenMessages(messages.vi.models)).sort()).toEqual(
      Object.keys(flattenMessages(modelSourceHashes)).sort(),
    );
    const placeholders = (value: string) =>
      [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort();
    for (const key of Object.keys(en))
      expect(placeholders(vi[key]!), key).toEqual(placeholders(en[key]!));
  });

  it('rejects sentence-length segments and broken acronym casing', () => {
    for (const key of [
      'clientErrors.jSONTooLarge',
      'shell.wBHelp',
      `project.${'a'.repeat(33)}`,
      'models.BadId',
    ])
      expect(validMessageKey(key), key).toBe(false);
    expect(validMessageKey('training.import_modules.description')).toBe(true);
    expect(validMessageKey('clientErrors.jsonTooLarge')).toBe(true);
  });

  it('has no orphan catalog keys outside explicit closed-enum maps', () => {
    const en = {
      ...flattenMessages(messages.en),
      ...flattenMessages(messages.vi.models, 'models'),
    };
    const referenced = new Set<string>([
      ...dynamicMessageKeys,
      ...Object.keys(modelSourceHashes).flatMap((id) => [
        `models.${id}.description`,
        `models.${id}.bestFor`,
        `models.${id}.shortDescription`,
        `models.${id}.pros.first`,
        `models.${id}.pros.second`,
      ]),
    ]);
    for (const file of [...sourceFiles(app), ...sourceFiles(resolve('shared/schemas'))].filter(
      (file) => !file.includes('/components/ui/'),
    )) {
      const source = readFileSync(file, 'utf8');
      const expressions = file.endsWith('.vue') ? componentExpressions(source, file) : [source];
      for (const expression of expressions)
        for (const key of [
          ...literalTranslationKeys(expression, file),
          ...storedTranslationKeys(expression, file),
        ])
          referenced.add(key);
    }
    expect(Object.keys(en).filter((key) => !referenced.has(key))).toEqual([]);
  });
});
