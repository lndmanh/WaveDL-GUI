import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

export const MAX_EDITOR_OBSERVATIONS = 8;
export const EDITOR_OBSERVATION_TIMEOUT_MS = 15000;

// This observes the existing public editor region and native label association.
// It does not replace actions.fill's subsequent geometry/exposure preflight.
export function editorFieldObservationExpression(diagnostic = false) {
  return `(() => {
    const refuse = reason => ${diagnostic ? '{ return {refusal:reason}; }' : 'false'};
    const regions = Array.from(document.querySelectorAll('section[aria-labelledby="project-title"]'));
    if (regions.length !== 1) return refuse('region-count');
    const region = regions[0], heading = region.querySelector('#project-title');
    if (!region.isConnected || heading?.textContent.trim() !== 'Build a training run') return refuse('region-heading');
    const labels = Array.from(region.querySelectorAll('label')).filter(e => e.textContent.trim() === 'Python interpreter');
    if (labels.length !== 1 || !labels[0].htmlFor) return refuse('label-count-or-for');
    const label = labels[0];
    const matches = Array.from(document.querySelectorAll('[id]')).filter(e => e.id === label.htmlFor);
    if (matches.length !== 1) return refuse('field-id-count');
    const field = matches[0];
    const visible = e => e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && Number(getComputedStyle(e).opacity) > 0;
    if (!region.contains(field) || field.tagName !== 'INPUT' || field.name !== 'runtime.python') return refuse('field-identity');
    if (!visible(label)) return refuse('label-visibility');
    if (!visible(field)) return refuse('field-visibility');
    if (field.disabled || field.matches(':disabled') || field.getAttribute('aria-disabled') === 'true') return refuse('field-disabled');
    if (field.labels?.length !== 1 || field.labels[0] !== label) return refuse('native-label-association');
    return { id: field.id, label: 'Python interpreter', visible: true, association: true };
  })()`;
}

export function editorFieldReadyExpression() {
  return `!!(${editorFieldObservationExpression()})`;
}

// The interpreter lives on the builder's "Runs on" block; every block is a
// pipeline tab, so opening the editor is selecting that tab. Automatic setup
// hides the interpreter, so an authored one is edited in Manual.
export async function openTrainingEditor({ cli, dom }) {
  const tab = '[data-testid="guide-step-3"]';
  await cli('scrollintoview', tab);
  await cli('click', tab);
  await cli('wait', '--fn', `document.querySelector('${tab}')?.getAttribute('aria-selected') === 'true'`);
  const manual = '[data-testid="runtime-setup"] [data-value="manual"]';
  await cli('wait', '--fn', `!!document.querySelector('${manual}')`);
  if (await dom(`JSON.stringify(document.querySelector('${manual}')?.getAttribute('data-state') !== 'on')`)) {
    await cli('scrollintoview', manual);
    await cli('click', manual);
    await cli('wait', '--fn', `document.querySelector('${manual}')?.getAttribute('data-state') === 'on'`);
  }
  await cli('wait', '--fn', editorFieldReadyExpression());
  const expression = `JSON.stringify(${editorFieldObservationExpression()})`;
  // Native waits above have their own CLI timeout; this budget applies only to
  // the following independent DOM observations, not the block switch.
  const deadline = performance.now() + EDITOR_OBSERVATION_TIMEOUT_MS;
  let candidate = null;
  for (let attempt = 0; attempt < MAX_EDITOR_OBSERVATIONS; attempt++) {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) break;
    const current = await dom(expression, remaining);
    if (performance.now() >= deadline) break;
    const valid = current && current.visible === true && current.association === true
      && current.label === 'Python interpreter' && typeof current.id === 'string' && current.id;
    if (valid && candidate && isDeepStrictEqual(current, candidate)) return current;
    candidate = valid ? current : null;
  }
  assert.fail('Training editor interpreter label association did not stabilize within bounded DOM observations');
}
