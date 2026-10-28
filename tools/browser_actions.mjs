// Public-DOM browser actions for agent-browser 0.26. No application-state writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

export const MAX_EXPOSURE_OBSERVATIONS = 8;
export const EXPOSURE_OBSERVATION_TIMEOUT_MS = 15000;

const trainingFields = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web/app/i18n/locales/en/training-fields.json'),
    'utf8',
  ),
);
const trainingFieldLabels = Object.fromEntries(
  Object.entries(trainingFields).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || !('label' in value) || typeof value.label !== 'string')
      return [];
    return [[name, value.label], [value.label.toLowerCase().replaceAll(' ', '_'), value.label]];
  }),
);

export function normalizeTrainingFieldLabel(name) {
  const key = name.trim().toLowerCase().replaceAll(' ', '_');
  return trainingFieldLabels[key] ?? name;
}

export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

export function controlLocator(kind, name, { scope } = {}) {
  const literal = xpathLiteral(kind === 'field' ? normalizeTrainingFieldLabel(name) : name);
  const base = scope ? `(${scope})` : '';
  if (kind === 'button') return `xpath=${base}//button[@aria-label=${literal} or normalize-space(.)=${literal}]`;
  if (kind === 'summary') return `xpath=${base}//*[self::summary or (self::button and @aria-expanded)][normalize-space(.)=${literal}]`;
  if (kind === 'option') return `xpath=${base}//*[@role="option" and (@data-value=${literal} or normalize-space(.)=${literal})]`;
  if (kind === 'field') return `xpath=//*[@id=${base}//label[normalize-space(.)=${literal}]/@for]`;
  throw new Error(`Unsupported browser control kind: ${kind}`);
}

export function controlExpression(kind, name, options = {}) {
  if (options.locator && !options.locator.startsWith('xpath=')) {
    return `Array.from(document.querySelectorAll(${JSON.stringify(options.locator)}))`;
  }
  const selector = JSON.stringify((options.locator ?? controlLocator(kind, name, options)).slice(6));
  return `Array.from((() => {
    const nodes = document.evaluate(${selector}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return Array.from({length: nodes.snapshotLength}, (_, index) => nodes.snapshotItem(index));
  })())`;
}

// Native clicks use raw coordinates, without auto-scroll or hit-testing. The
// native driver can stall on rAF promises after layout reads, so readiness uses
// synchronous exposure polling followed by two consecutive matching controller
// DOM reads, within bounded observations. Invalid/moving reads reset the pair.
// This checks observed geometry stability, not completion of two render frames.
export const DRIVER_READINESS_MODE = 'sync-exposure-poll-and-two-controller-dom-observations';

export function exposureExpression(kind, name, options = {}) {
  const exposedName = kind === 'field' ? normalizeTrainingFieldLabel(name) : name;
  return `(() => {
    const controls = ${controlExpression(kind, name, options)};
    if (controls.length !== 1) return false;
    const element = controls[0];
    ${options.verifyNativeLabel ? `if (element.labels?.length !== 1 || element.labels[0].textContent.trim() !== ${JSON.stringify(exposedName)}) return false;` : ''}
    if (!element.isConnected || !element.getClientRects().length || element.disabled || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
    const rect = element.getBoundingClientRect();
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!(x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && (hit === element || element.contains(hit)))) return false;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`;
}

export function actionableExpression(kind, name, options = {}) {
  return `!!(${exposureExpression(kind, name, options)})`;
}

export function createBrowserActions({ cli, dom, snapshot, now = () => performance.now() }) {
  const validExposure = (value) => value && typeof value === 'object'
    && ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'].every(key => Number.isFinite(value[key]))
    && value.width > 0 && value.height > 0 && value.viewportWidth > 0 && value.viewportHeight > 0;
  const describe = async (kind, name, options = {}) => dom(`JSON.stringify(${controlExpression(kind, name, options)}.map(element => ({
    tag: element.tagName, text: element.getAttribute('aria-label') || element.textContent.trim(),
    visible: !!element.getClientRects().length, disabled: !!element.disabled,
    leaf: element.children.length === 0, value: element.getAttribute('data-value') ?? element.value,
    id: element.id, locator: element.id ? '#' + CSS.escape(element.id) : null,
    labels: Array.from(element.labels ?? []).map(label => label.textContent.trim())
  })))`);
  const prepare = async (kind, name, optional = false, options = {}) => {
    await snapshot();
    let controls = await describe(kind, name, options);
    if (optional && controls.length === 0) return false;
    let attemptedReveal = false;
    if (!controls.some(control => control.visible)) {
      const reveal = await dom(`JSON.stringify((() => {
        const element = ${controlExpression(kind, name, options)}[0];
        for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
          if (parent.matches('[role="tabpanel"][data-state="inactive"]')) {
            const panelId = parent.id;
            const trigger = Array.from(document.querySelectorAll('[role="tab"][aria-controls]'))
              .find(candidate => candidate.getAttribute('aria-controls') === panelId);
            if (trigger?.getAttribute('data-testid') === 'training-tab-essentials') return null;
            if (trigger) return '#'+CSS.escape(trigger.id);
            return null;
          }
          if (parent.matches('[data-slot="collapsible-content"][data-state="closed"]')) {
            const trigger = document.querySelector('[data-slot="collapsible-trigger"][aria-controls="' + CSS.escape(parent.id) + '"]');
            if (trigger) return '[data-slot="collapsible-trigger"][aria-controls="' + CSS.escape(parent.id) + '"]';
            return null;
          }
        }
        return null;
      })())`);
      if (reveal) {
        attemptedReveal = true;
        await cli('scrollintoview', reveal);
        await cli('click', reveal);
        controls = await describe(kind, name, options);
        const exposed = controls.filter(control => control.visible);
        assert(exposed.length > 0, `${name} is not exposed in the DOM`);
      }
    }
    // Render readiness must precede semantic discovery; a snapshot alone is not
    // a readiness barrier. Duplicates fail closed, including hidden duplicates
    // because native semantic locators choose the first DOM match.
    if (!controls.some(control => control.visible) && !attemptedReveal) {
      try {
        await cli('wait', '--fn', `${controlExpression(kind, name, options)}.some(element => element.getClientRects().length)`);
      } catch {
        assert.fail(`${name} is not exposed in the DOM`);
      }
      controls = await describe(kind, name, options);
    }
    assert(controls.some(control => control.visible), `${name} is not exposed in the DOM`);
    // Retained Settings/Project forms can have identical hidden labels. Fields
    // are acted on only through the existing unique ID of the visible control.
    if (kind === 'field') controls = controls.filter(control => control.visible);
    assert(controls.length === 1, `Expected one ${kind}: ${name}; found ${controls.length}`);
    assert(!controls[0].disabled, `${name} unexpectedly disabled`);
    assert(controls[0].visible, `${name} is not exposed in the DOM`);
    if (kind === 'field') assert(controls[0].id && controls[0].locator, `Visible field ${name} requires an existing stable ID`);
    if (kind === 'field' && options.verifyNativeLabel) assert(controls[0].labels?.length === 1 && controls[0].labels[0] === normalizeTrainingFieldLabel(name), `Explicit field ${name} lost its native label association`);
    const locator = kind === 'field' ? controls[0].locator : (options.locator ?? controlLocator(kind, name, options));
    await cli('scrollintoview', locator);
    const exposureOptions = { locator, verifyNativeLabel: options.verifyNativeLabel };
    await cli('wait', '--fn', actionableExpression(kind, name, exposureOptions));
    const observation = `JSON.stringify(${exposureExpression(kind, name, exposureOptions)})`;
    // CLI waits above have separate timeouts. This monotonic budget applies
    // only to DOM observations of the exact original locator, never rediscovery.
    const deadline = now() + EXPOSURE_OBSERVATION_TIMEOUT_MS;
    let candidate = null;
    for (let attempt = 0; attempt < MAX_EXPOSURE_OBSERVATIONS; attempt++) {
      const remaining = Math.floor(deadline - now());
      if (remaining < 1) break;
      const current = await dom(observation, remaining);
      if (now() >= deadline) break;
      if (validExposure(current) && candidate && isDeepStrictEqual(current, candidate)) return locator;
      candidate = validExposure(current) ? current : null;
    }
    assert.fail(`${name} exposure did not stabilize within bounded controller DOM observations`);
  };
  return {
    describe,
    readyControl: prepare,
    async showTrainingField(label, options = {}) {
      const matchingTab = await dom(`JSON.stringify((() => {
        const controls = ${controlExpression('field', label, options)};
        const field = controls.find(element => element.getClientRects().length) ?? controls.find(element => element.closest('section[aria-labelledby="project-title"]')?.getClientRects().length) ?? controls[0];
        const panel = field?.closest('[role="tabpanel"][data-state="inactive"]');
        if (!panel) return null;
        const trigger = Array.from(document.querySelectorAll('[role="tab"][aria-controls]')).find(element => element.getAttribute('aria-controls') === panel.id);
        return trigger?.matches('[data-testid="training-tab-essentials"],[data-testid="training-tab-advanced"]') ? { locator: '#' + CSS.escape(trigger.id), name: trigger.textContent.trim() } : null;
      })())`);
      if (matchingTab) await this.button(matchingTab.name, false, { locator: matchingTab.locator });
    },
    async button(name, optional = false, options = {}) {
      const locator = await prepare('button', name, optional, options);
      if (!locator) return false;
      if (options.scope || options.locator) await cli('click', locator);
      else await cli('find', 'role', 'button', 'click', '--name', name, '--exact');
      return true;
    },
    async fill(label, value, options = {}) {
      await this.showTrainingField(label, options);
      const locator = await prepare('field', label, false, { ...options, verifyNativeLabel: !!options.locator });
      await cli('fill', locator, String(value));
      const controls = await describe('field', label, { locator });
      assert(controls.length === 1 && controls[0].value === String(value), `UI field ${label} did not retain authored value`);
      if (options.locator) assert(controls[0].labels?.length === 1 && controls[0].labels[0] === normalizeTrainingFieldLabel(label), `Explicit field ${label} lost its native label association after fill`);
    },
    async select(label, value) {
      await this.showTrainingField(label);
      const locator = await prepare('field', label);
      const control = (await describe('field', label, { locator }))[0];
      if (control?.tag === 'SELECT') await cli('select', locator, String(value));
      else {
        await cli('click', locator);
        await this.option(String(value || 'none'));
      }
      const controls = await describe('field', label, { locator });
      assert(controls.length === 1 && (controls[0].value === String(value) || controls[0].value === String(value || 'none')), `UI select ${label} did not retain authored value`);
    },
    async options(label) {
      const locator = await prepare('field', label);
      const control = (await describe('field', label, { locator }))[0];
      if (control?.tag === 'SELECT') return dom(`JSON.stringify(Array.from(document.querySelector(${JSON.stringify(locator)}).options).map(option => ({value: option.value, label: option.textContent.trim(), disabled: option.disabled})))`);
      await cli('click', locator);
      await cli('wait', '--fn', '!!document.querySelector("[role=option]")');
      const result = await dom('JSON.stringify(Array.from(document.querySelectorAll("[role=option]")).map(option => ({value: option.getAttribute("data-value"), label: option.textContent.trim(), disabled: option.getAttribute("aria-disabled") === "true"})))');
      await cli('press', 'Escape');
      return result;
    },
    async openPlan() {
      await cli('wait', '--fn', 'Array.from(document.querySelectorAll("[data-testid=plan-raw-disclosure]")).some(element => element.getClientRects().length)');
      const opened = await dom('JSON.stringify(Array.from(document.querySelectorAll("[data-testid=plan-raw-disclosure]")).filter(element => element.getClientRects().length).map(element => ({expanded:element.getAttribute("aria-expanded"),locator:"#"+CSS.escape(element.id)})))');
      assert(opened.length === 1, 'Exactly one visible persisted-plan disclosure is required');
      if (opened[0].expanded !== 'true') await this.button('Full persisted execution plan', false, { locator: opened[0].locator });
    },
    async option(name, options = {}) {
      const locator = await prepare('option', name, false, options);
      await cli('click', locator);
    },
    async expandSummary(name) {
      const locator = await prepare('summary', name);
      const expression = `(() => { const element = ${controlExpression('summary', name)}[0]; return element?.tagName === 'SUMMARY' ? element.closest('details')?.open : element?.getAttribute('aria-expanded') === 'true'; })()`;
      assert(await dom(`JSON.stringify(${expression})`) === false, `Summary ${name} must begin closed`);
      await cli('click', locator);
      await cli('wait', '--fn', `${expression} === true`);
      assert(await dom(`JSON.stringify(${expression})`) === true, `Summary ${name} did not expand`);
    },
  };
}

export async function openPlanDisclosure({ cli, dom }) {
  await createBrowserActions({ cli, dom, snapshot: () => cli('snapshot', '-i') }).openPlan();
}
