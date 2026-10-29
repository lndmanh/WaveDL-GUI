import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ElementTypes,
  NodeTypes,
  type RootNode,
  type TemplateChildNode,
} from '@vue/compiler-dom';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';

const components = new URL('../../app/components/', import.meta.url);
const controller = readFileSync(new URL('WorkstationController.vue', components), 'utf8');

function template(source: string): RootNode {
  const ast = parse(source).descriptor.template?.ast;
  if (!ast) throw new Error('Component has no template');
  return ast;
}

function elements(node: RootNode | TemplateChildNode): TemplateChildNode[] {
  if (!('children' in node)) return [];
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : [child, ...elements(child)],
  );
}

/** Retained sections are hidden with v-show, which Vue drops on fragment roots. */
function hiddenSections(): Map<string, string> {
  const imports = new Map<string, string>();
  const pattern =
    /(?:import\s+(\w+)\s+from\s*|const\s+(\w+)\s*=\s*defineAsyncComponent\(\(\)\s*=>\s*import\()'(\.\/[^']+\.vue)'/g;
  for (const match of controller.matchAll(pattern)) {
    const name = match[1] ?? match[2];
    const path = match[3];
    if (name && path) imports.set(name, path);
  }
  const sections = new Map<string, string>();
  for (const node of elements(template(controller))) {
    if (
      node.type === NodeTypes.ELEMENT &&
      node.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'show')
    ) {
      const path = imports.get(node.tag);
      if (!path) throw new Error(`Cannot resolve hidden section ${node.tag}`);
      sections.set(node.tag, fileURLToPath(new URL(path, components)));
    }
  }
  return sections;
}

describe('workstation section visibility', () => {
  const sections = hiddenSections();

  it('finds every retained section the controller hides', () => {
    expect([...sections.keys()].sort()).toEqual([
      'DatasetsWorkspace',
      'ProjectContainer',
      'ResultsContainer',
      'RunsWorkspace',
    ]);
  });

  it.each([...sections])('%s renders one plain element root for v-show', (_, path) => {
    const roots = template(readFileSync(path, 'utf8')).children.filter(
      (node) => node.type !== NodeTypes.COMMENT,
    );
    expect(roots).toHaveLength(1);
    const [root] = roots;
    expect(root?.type === NodeTypes.ELEMENT && root.tagType === ElementTypes.ELEMENT).toBe(true);
  });
});
