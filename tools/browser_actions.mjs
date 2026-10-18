// Public-DOM browser actions for agent-browser 0.26. No application-state writes.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

export const MAX_EXPOSURE_OBSERVATIONS = 8;
export const EXPOSURE_OBSERVATION_TIMEOUT_MS = 15000;

export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

export function controlLocator(kind, name, { scope } = {}) {
  const literal = xpathLiteral(name);
  const base = scope ? `(${scope})` : '';
  if (kind === 'button') return `xpath=${base}//button[@aria-label=${literal} or normalize-space(.)=${literal}]`;
  if (kind === 'summary') return `xpath=${base}//summary[normalize-space(.)=${literal}]`;
  if (kind === 'option') return `xpath=${base}//*[@role="option" and normalize-space(.)=${literal}]`;
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
  return `(() => {
    const controls = ${controlExpression(kind, name, options)};
    if (controls.length !== 1) return false;
    const element = controls[0];
    ${options.verifyNativeLabel ? `if (element.labels?.length !== 1 || element.labels[0].textContent.trim() !== ${JSON.stringify(name)}) return false;` : ''}
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
    leaf: element.children.length === 0, value: element.value,
    id: element.id, locator: element.id ? '#' + CSS.escape(element.id) : null,
    labels: Array.from(element.labels ?? []).map(label => label.textContent.trim())
  })))`);
  const prepare = async (kind, name, optional = false, options = {}) => {
    await snapshot();
    let controls = await describe(kind, name, options);
    if (optional && controls.length === 0) return false;
    // Render readiness must precede semantic discovery; a snapshot alone is not
    // a readiness barrier. Duplicates fail closed, including hidden duplicates
    // because native semantic locators choose the first DOM match.
    if (!controls.some(control => control.visible)) {
      await cli('wait', '--fn', `${controlExpression(kind, name, options)}.some(element => element.getClientRects().length)`);
      controls = await describe(kind, name, options);
    }
    // Retained Settings/Project forms can have identical hidden labels. Fields
    // are acted on only through the existing unique ID of the visible control.
    if (kind === 'field') controls = controls.filter(control => control.visible);
    assert(controls.length === 1, `Expected one ${kind}: ${name}; found ${controls.length}`);
    assert(!controls[0].disabled, `${name} unexpectedly disabled`);
    assert(controls[0].visible, `${name} is not exposed in the DOM`);
    if (kind === 'field') assert(controls[0].id && controls[0].locator, `Visible field ${name} requires an existing stable ID`);
    if (kind === 'field' && options.verifyNativeLabel) assert(controls[0].labels?.length === 1 && controls[0].labels[0] === name, `Explicit field ${name} lost its native label association`);
    if (kind === 'summary') assert(controls[0].leaf, `Native exact-text summary must be a leaf: ${name}`);
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
    async button(name, optional = false, options = {}) {
      const locator = await prepare('button', name, optional, options);
      if (!locator) return false;
      if (options.scope || options.locator) await cli('click', locator);
      else await cli('find', 'role', 'button', 'click', '--name', name, '--exact');
      return true;
    },
    async fill(label, value, options = {}) {
      const locator = await prepare('field', label, false, { ...options, verifyNativeLabel: !!options.locator });
      await cli('fill', locator, String(value));
      const controls = await describe('field', label, { locator });
      assert(controls.length === 1 && controls[0].value === String(value), `UI field ${label} did not retain authored value`);
      if (options.locator) assert(controls[0].labels?.length === 1 && controls[0].labels[0] === label, `Explicit field ${label} lost its native label association after fill`);
    },
    async select(label, value) {
      const locator = await prepare('field', label);
      await cli('select', locator, String(value));
      const controls = await describe('field', label, { locator });
      assert(controls.length === 1 && controls[0].value === String(value), `UI select ${label} did not retain authored value`);
    },
    async option(name, options = {}) {
      const locator = await prepare('option', name, false, options);
      await cli('click', locator);
    },
    async expandSummary(name) {
      const locator = await prepare('summary', name);
      const expression = `${controlExpression('summary', name)}[0]?.closest('details')?.open`;
      assert(await dom(`JSON.stringify(${expression})`) === false, `Summary ${name} must begin closed`);
      await cli('click', locator);
      await cli('wait', '--fn', `${expression} === true`);
      assert(await dom(`JSON.stringify(${expression})`) === true, `Summary ${name} did not expand`);
    },
  };
}
