import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { controllerIdentityScript } from './browser_controller_identity.mjs';

test('detects same-URL controller object replacement and controllerchange independently', () => {
  const original = { scriptURL: 'http://127.0.0.1/sw.js' };
  let listener;
  const serviceWorker = {
    controller: original,
    addEventListener: (name, handler) => { assert.equal(name, 'controllerchange'); listener = handler; },
  };
  const context = createContext({ window: {}, navigator: { serviceWorker } });
  runInContext(controllerIdentityScript, context);
  const observe = () => JSON.parse(JSON.stringify(context.window.__wavedlControllerIdentity()));
  assert.deepEqual(observe(), { originalControllerPresent: true, sameControllerObject: true, controllerChanges: 0 });
  serviceWorker.controller = { scriptURL: original.scriptURL };
  assert.deepEqual(observe(), { originalControllerPresent: true, sameControllerObject: false, controllerChanges: 0 });
  listener();
  serviceWorker.controller = original;
  assert.deepEqual(observe(), { originalControllerPresent: true, sameControllerObject: true, controllerChanges: 1 });
  assert(!JSON.stringify(observe()).includes('http://'));
});
test('missing original controller never satisfies identity observation', () => {
  const context = createContext({ window: {}, navigator: { serviceWorker: { controller: null, addEventListener() {} } } });
  runInContext(controllerIdentityScript, context);
  assert.equal(context.window.__wavedlControllerIdentity().originalControllerPresent, false);
});
