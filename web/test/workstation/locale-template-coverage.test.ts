import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { baseParse, NodeTypes, type RootNode, type TemplateChildNode } from '@vue/compiler-dom';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

const components = fileURLToPath(new URL('../../workstation/components', import.meta.url));
const technicalText = new Set(['WaveDL', 'ONNX', 'D', 'English', 'Tiếng Việt']);
const accessibleAttributes = new Set(['aria-label', 'title', 'placeholder', 'alt']);

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? componentFiles(path) : entry.name.endsWith('.vue') ? [path] : [];
  });
}

/** Raw runtime evidence belongs in interpolation, never this static UI copy. */
function untranslatedTemplateCopy(source: string): string[] {
  const descriptor = parse(source).descriptor;
  if (!descriptor.template) return [];
  const missed: string[] = [];
  const inspect = (text: string, line: number) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]{2}/.test(normalized) && !technicalText.has(normalized))
      missed.push(`${line}: ${normalized}`);
  };
  function visit(node: RootNode | TemplateChildNode): void {
    if (node.type === NodeTypes.TEXT) inspect(node.content, node.loc.start.line);
    if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props) {
        if (prop.type === NodeTypes.ATTRIBUTE && accessibleAttributes.has(prop.name) && prop.value)
          inspect(prop.value.content, prop.loc.start.line);
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        if (typeof child !== 'string') visit(child);
      }
    }
  }
  visit(baseParse(descriptor.template.content));
  return missed;
}

describe('workstation locale template coverage', () => {
  it('covers every static display/accessibility phrase, apart from documented technical names', () => {
    const files = componentFiles(components);
    expect(files.length).toBeGreaterThanOrEqual(43);
    const missed = files.flatMap((path) =>
      untranslatedTemplateCopy(readFileSync(path, 'utf8')).map(
        (copy) => `${relative(components, path)}:${copy}`,
      ),
    );
    expect(missed).toEqual([]);
  });
  it('detects missed visible text and accessible names without flagging raw evidence', () => {
    expect(
      untranslatedTemplateCopy(
        '<template><p>Waiting for metrics.</p><button aria-label="Close chart">{{ path }}</button></template>',
      ),
    ).toEqual(['1: Waiting for metrics.', '1: Close chart']);
    expect(
      untranslatedTemplateCopy(
        '<template><p>{{ rawRuntimePayload }}</p><p>ONNX</p><p>{{ t("waiting") }}</p></template>',
      ),
    ).toEqual([]);
  });
});
