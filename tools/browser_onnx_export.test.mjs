import assert from 'node:assert/strict';
import test from 'node:test';
import { onnxScope } from './browser_onnx_export.mjs';

test('ONNX subgate keeps supported CPU/export-only scope explicit', () => {
  assert.match(onnxScope, /CPU/);
  assert.match(onnxScope, /opset-17/);
  assert.match(onnxScope, /browser download/);
});
