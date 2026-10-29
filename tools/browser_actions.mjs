// Public-DOM browser actions for agent-browser 0.26. No application-state writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

export const MAX_EXPOSURE_OBSERVATIONS = 8;
export const EXPOSURE_OBSERVATION_TIMEOUT_MS = 15000;
// A control can sit in a closed section of an inactive builder block: each
// reveal opens one container, outermost first.
export const MAX_REVEALS = 3;

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src/wavedl_daemon/web/app');
const trainingFields = JSON.parse(readFileSync(join(appRoot, 'i18n/locales/en/training-fields.json'), 'utf8'));
const builderMessages = JSON.parse(readFileSync(join(appRoot, 'i18n/locales/en/builder.json'), 'utf8'));
const trainingFieldLabels = Object.fromEntries(
  Object.entries(trainingFields).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || !('label' in value) || typeof value.label !== 'string')
      return [];
    return [[name, value.label], [value.label.toLowerCase().replaceAll(' ', '_'), value.label]];
  }),
);
const trainingFieldNames = Object.fromEntries(
  Object.entries(trainingFields).flatMap(([name, value]) =>
    value && typeof value === 'object' && typeof value.label === 'string' ? [[value.label, name]] : []),
);

// Choice labels come from the same tables the app renders with, so a
// segmented control is driven by the exact visible text of the wanted value.
function choiceTable(source, name) {
  const body = source.match(new RegExp(`const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`))?.[1];
  assert(body, `${name} is missing from src/wavedl_daemon/web/app/i18n/dynamic-keys.ts`);
  return Object.fromEntries(Array.from(body.matchAll(/^\s*'?([\w.]+)'?: '([^']*)',$/gm), (match) => [match[1], match[2]]));
}
const dynamicKeys = readFileSync(join(appRoot, 'i18n/dynamic-keys.ts'), 'utf8');
const choiceMessageKeys = choiceTable(dynamicKeys, 'trainingChoiceMessageKeys');
const technicalChoiceLabels = choiceTable(dynamicKeys, 'technicalChoiceLabels');

export function builderMessage(key) {
  const message = builderMessages[key];
  assert(typeof message === 'string', `Unknown builder message ${key}`);
  return message;
}

export function normalizeTrainingFieldLabel(name) {
  const key = name.trim().toLowerCase().replaceAll(' ', '_');
  return trainingFieldLabels[key] ?? name;
}

export function trainingFieldName(label) {
  return trainingFieldNames[normalizeTrainingFieldLabel(label)] ?? null;
}

export function trainingChoiceLabel(field, choice) {
  const key = choiceMessageKeys[`${field}.${choice}`];
  if (key) return builderMessage(key.replace(/^builder\./, ''));
  return technicalChoiceLabels[choice] ?? choice;
}

// Builder hooks. Blocks are pipeline tabs; every inspector stays mounted and
// only the active one is shown.
export const PIPELINE_REVIEW = 'xpath=//*[@data-testid="project-stepper"]//button[not(@role="tab")]';
export const PLAN_SUBMIT = `xpath=//form[@role="tabpanel"]//button[@type="submit" and normalize-space(.)=${xpathLiteral(builderMessages.createPlan)}]`;
export const BLOCKS = Object.freeze({ dataset: 0, model: 1, training: 2, runtime: 3, plan: 4 });

export function datasetSelectedExpression(name) {
  return `(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="selected-dataset"]'));
    const block = document.querySelector('[data-testid="guide-step-0"]');
    return cards.length === 1 && cards[0].textContent.trim() === ${JSON.stringify(name)}
      && (cards[0].nextElementSibling?.textContent ?? '').trim().endsWith('/ ' + ${JSON.stringify(name)})
      && block?.getAttribute('data-state') === 'complete' && block.textContent.includes(${JSON.stringify(name)});
  })()`;
}

export function modelChosenExpression(key) {
  return `(() => {
    const rows = Array.from(document.querySelectorAll(${JSON.stringify(`[data-testid="model-card"][data-model-entry="${key}"]`)}));
    const chosen = rows.length > 0 && rows.every(row => Array.from(row.querySelectorAll('[aria-label]')).some(e => e.getAttribute('aria-label') === ${JSON.stringify(builderMessages.modelInUse)}));
    const block = document.querySelector('[data-testid="guide-step-1"]');
    return chosen && !!block && block.getAttribute('data-state') !== 'pending';
  })()`;
}

// The Plan block before a plan exists: its readiness checklist and whether its
// own "Create plan" submit is enabled.
export function planReadinessExpression() {
  return `(() => {
    const list = document.querySelector(${JSON.stringify(`ul[aria-label="${builderMessages.readiness}"]`)});
    const submit = ${controlExpression('button', builderMessages.createPlan, { locator: PLAN_SUBMIT })}[0];
    const step = document.querySelector('[role="tab"][aria-current="step"]');
    return {
      step: step?.getAttribute('data-testid') ?? null,
      createPlan: submit ? { visible: !!submit.getClientRects().length, disabled: !!submit.disabled } : null,
      items: Array.from(list?.querySelectorAll('li') ?? []).map(item => {
        const [label, detail] = Array.from(item.children[1]?.children ?? []).map(e => e.textContent.trim());
        return { label, detail, done: item.querySelector('[data-done]')?.getAttribute('data-done') === 'true',
          action: item.querySelector('button')?.textContent.trim() ?? null };
      }),
    };
  })()`;
}

// Reads what a control shows: switches and checkboxes by ARIA state, a
// segmented control by its pressed item's text, everything else by value.
export const CONTROL_VALUE_SOURCE = `(element => {
  if (!element) return null;
  const role = element.getAttribute('role');
  if (role === 'switch' || role === 'checkbox' || role === 'radio') return element.getAttribute('aria-checked');
  if (role === 'group' && element.querySelector('[data-slot="toggle-group-item"]'))
    return element.querySelector('[data-slot="toggle-group-item"][data-state="on"]')?.textContent.trim() ?? '';
  return element.getAttribute('data-value') ?? element.value ?? null;
})`;

export function xpathLiteral(value) {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

export function controlLocator(kind, name, { scope } = {}) {
  const literal = xpathLiteral(kind === 'field' ? normalizeTrainingFieldLabel(name) : name);
  const base = scope ? `(${scope})` : '';
  if (kind === 'button') return `xpath=${base}//button[@aria-label=${literal} or normalize-space(.)=${literal}]`;
  // Section triggers carry an icon and a change count beside their title; match the title leaf.
  if (kind === 'summary') return `xpath=${base}//*[self::summary or (self::button and @aria-expanded)][normalize-space(.)=${literal} or .//*[not(*) and normalize-space(.)=${literal}]]`;
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

// The container to open next so a hidden control becomes visible: the
// outermost of an inactive builder block (its pipeline tab) and a closed
// collapsible section (its trigger). Null when nothing known hides it.
export function revealExpression(kind, name, options = {}) {
  return `JSON.stringify((() => {
    const controls = ${controlExpression(kind, name, options)};
    const element = controls.find(e => e.getClientRects().length)
      ?? controls.find(e => e.closest('section[aria-labelledby="project-title"]')) ?? controls[0];
    if (!element || element.getClientRects().length) return null;
    let reveal = null;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches('[data-slot="collapsible-content"][data-state="closed"]')) {
        // A trigger rendered before its content can carry an empty aria-controls;
        // then it is found as the trigger of the content's own collapsible.
        const controlled = '[data-slot="collapsible-trigger"][aria-controls="' + CSS.escape(parent.id) + '"]';
        const sibling = '[data-slot="collapsible"]:has(> #' + CSS.escape(parent.id) + ') > [data-slot="collapsible-trigger"]';
        reveal = !parent.id ? null : document.querySelector(controlled) ? controlled
          : document.querySelectorAll(sibling).length === 1 ? sibling : null;
      }
      // A v-show region naming its own opener (Runs on's Manual editor) is opened by it.
      const opener = parent.getAttribute('data-reveal-target');
      if (opener && parent.style.display === 'none') reveal = document.querySelector(opener) ? opener : null;
      const panel = parent.parentElement;
      if (panel?.matches('form[role="tabpanel"]') && parent.style.display === 'none') {
        const tab = '[data-testid="guide-step-' + Array.from(panel.children).indexOf(parent) + '"]';
        reveal = document.querySelector(tab)?.getAttribute('aria-controls') === panel.id ? tab : null;
      }
    }
    return reveal;
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
    leaf: element.children.length === 0, value: ${CONTROL_VALUE_SOURCE}(element),
    toggleGroup: element.getAttribute('role') === 'group' && !!element.querySelector('[data-slot="toggle-group-item"]'),
    id: element.id, locator: element.id ? '#' + CSS.escape(element.id) : null,
    labels: Array.from(element.labels ?? []).map(label => label.textContent.trim())
  })))`);
  // Opens the containers hiding a control, outermost first. Returns whether
  // anything was opened; never opens anything when a match is already visible.
  const reveal = async (kind, name, options = {}) => {
    let opened = false;
    let previous = null;
    for (let attempt = 0; attempt < MAX_REVEALS; attempt++) {
      const target = await dom(revealExpression(kind, name, options));
      // A container that stays closed after its own control is used is not
      // retried: the control is then reported as not exposed.
      if (!target || target === previous) break;
      previous = target;
      opened = true;
      await cli('scrollintoview', target);
      await cli('click', target);
    }
    return opened;
  };
  const prepare = async (kind, name, optional = false, options = {}) => {
    await snapshot();
    let controls = await describe(kind, name, options);
    if (optional && controls.length === 0) return false;
    let attemptedReveal = false;
    if (!controls.some(control => control.visible) && await reveal(kind, name, options)) {
      attemptedReveal = true;
      controls = await describe(kind, name, options);
      assert(controls.some(control => control.visible), `${name} is not exposed in the DOM`);
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
    reveal,
    async showTrainingField(label, options = {}) {
      await reveal('field', label, options);
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
      if (control?.toggleGroup) {
        // Few-choice settings are segmented controls: press the item showing the value.
        const field = trainingFieldName(label);
        const text = field ? trainingChoiceLabel(field, String(value)) : String(value);
        if (control.value !== text) {
          await this.button(text, false, { locator: `xpath=//*[@id=${xpathLiteral(control.id)}]//button[normalize-space(.)=${xpathLiteral(text)}]` });
        }
        await cli('wait', '--fn', `${CONTROL_VALUE_SOURCE}(document.getElementById(${JSON.stringify(control.id)})) === ${JSON.stringify(text)}`);
        const controls = await describe('field', label, { locator });
        assert(controls.length === 1 && controls[0].value === text, `UI segmented control ${label} did not retain authored value`);
        return;
      }
      if (control?.tag === 'SELECT') await cli('select', locator, String(value));
      else {
        await cli('click', locator);
        await this.option(String(value || 'none'));
      }
      const controls = await describe('field', label, { locator });
      assert(controls.length === 1 && (controls[0].value === String(value) || controls[0].value === String(value || 'none')), `UI select ${label} did not retain authored value`);
    },
    // Runtime device is a radio card group without a field label.
    async device(value) {
      const locator = `[data-testid="device-${value}"]`;
      await this.button(`Device ${value}`, false, { locator });
      await cli('wait', '--fn', `document.querySelector(${JSON.stringify(locator)})?.getAttribute('aria-checked') === 'true'`);
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
      const expression = `(() => { const element = ${controlExpression('summary', name)}[0]; return element?.tagName === 'SUMMARY' ? element.closest('details')?.open : element?.getAttribute('aria-expanded') === 'true'; })()`;
      // A section in an inactive builder block is first brought into view;
      // its own disclosure must still begin closed.
      await reveal('summary', name);
      assert(await dom(`JSON.stringify(${expression})`) === false, `Summary ${name} must begin closed`);
      const locator = await prepare('summary', name);
      if (await dom(`JSON.stringify(${expression})`) !== true) await cli('click', locator);
      await cli('wait', '--fn', `${expression} === true`);
      assert(await dom(`JSON.stringify(${expression})`) === true, `Summary ${name} did not expand`);
    },
    // ---- New training run builder ------------------------------------------------
    async settleStartPanel(choice = 'fresh') {
      await cli('wait', '--fn', '!!document.querySelector(\'[data-testid="project-stepper"]\')');
      const offered = await dom('JSON.stringify(Array.from(document.querySelectorAll(\'[data-testid="start-fresh"],[data-testid="continue-draft"]\')).some(e => e.getClientRects().length))');
      if (!offered) return false;
      const testId = choice === 'continue' ? 'continue-draft' : 'start-fresh';
      await this.button(builderMessage(choice === 'continue' ? 'continueDraft' : 'startFresh'), false, { locator: `[data-testid="${testId}"]` });
      await cli('wait', '--fn', '!document.querySelector(\'[data-testid="start-fresh"]\')');
      return true;
    },
    async openProject(choice = 'fresh') {
      await this.button('New training run', false, { locator: '[data-testid="nav-project"]' });
      return this.settleStartPanel(choice);
    },
    async showBlock(block) {
      const index = typeof block === 'number' ? block : BLOCKS[block];
      assert(Number.isInteger(index), `Unknown builder block ${block}`);
      const tab = `[data-testid="guide-step-${index}"]`;
      await this.button(`Builder block ${block}`, false, { locator: tab });
      await cli('wait', '--fn', `document.querySelector(${JSON.stringify(tab)})?.getAttribute('aria-selected') === 'true'`);
    },
    async chooseModel(key) {
      const rows = `[data-testid="model-card"][data-model-entry="${key}"]`;
      await cli('wait', '--fn', `!!document.querySelector(${JSON.stringify(rows)})`);
      if (await dom(`JSON.stringify(${modelChosenExpression(key)})`) === true) return;
      await this.button(`Model ${key}`, false, { locator: `xpath=(//*[@data-testid="model-card" and @data-model-entry=${xpathLiteral(key)}])[1]` });
      await this.button(builderMessages.useThisModel, false, { locator: '[data-testid="model-select"]' });
      await cli('wait', '--fn', modelChosenExpression(key));
    },
    // The Plan block's own submit: an explicit, enabled request for a persisted plan.
    async createPlan() {
      await this.showBlock('plan');
      await this.button(builderMessages.createPlan, false, { locator: PLAN_SUBMIT });
    },
    // The strip's primary action. Unlike the Plan block submit it stays enabled
    // for an invalid draft, which it opens on the Plan block and validates.
    async reviewPlan() {
      await this.button('Pipeline review', false, { locator: PIPELINE_REVIEW });
    },
    // The standalone command goes to the system clipboard, which headless
    // Chromium will not read back (readText is permission-denied). The page's
    // own writeText is observed instead: the exact text the app hands to the
    // Clipboard API is recorded and then passed through to the real write, so
    // the app's "copied" notice still reports the real clipboard outcome.
    async copyStandaloneCommand() {
      const locator = await this.configMenuItem('Copy standalone CLI command');
      await dom(`JSON.stringify((() => {
        const clipboard = navigator.clipboard;
        if (!Object.hasOwn(clipboard, 'writeText')) {
          const write = clipboard.writeText.bind(clipboard);
          Object.defineProperty(clipboard, 'writeText', { configurable: true, value: (text) => {
            window.__wavedlCopiedText = String(text);
            return write(text);
          } });
        }
        window.__wavedlCopiedText = null;
        return true;
      })())`);
      await cli('click', locator);
    },
    async copiedCommand() {
      await cli('wait', '--text', 'Standalone POSIX command copied.');
      const text = await dom('JSON.stringify(window.__wavedlCopiedText ?? null)');
      assert(typeof text === 'string' && text, 'The copied standalone command was not handed to the clipboard');
      return text;
    },
    async configMenuItem(label) {
      await this.button(builderMessages.importExport, false, { locator: '[data-testid="config-menu"]' });
      const item = `xpath=//*[@role="menuitem"][.//*[not(*) and normalize-space(.)=${xpathLiteral(label)}]]`;
      return prepare('button', label, false, { locator: item });
    },
  };
}

export async function openPlanDisclosure({ cli, dom }) {
  await createBrowserActions({ cli, dom, snapshot: () => cli('snapshot', '-i') }).openPlan();
}
