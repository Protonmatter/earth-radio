import assert from 'node:assert/strict';
import test from 'node:test';
import * as harness from './browser/harness.mjs';

function requiredRetry() {
  assert.equal(typeof harness.retryKnownCaptureError, 'function', 'retryKnownCaptureError must be implemented');
  return harness.retryKnownCaptureError;
}

test('capture retry recovers from two transient compositor failures', async () => {
  const retryKnownCaptureError = requiredRetry();
  let attempts = 0;
  const result = await retryKnownCaptureError(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('UnknownVizError');
    return 'captured';
  }, { wait: async () => {} });

  assert.equal(result, 'captured');
  assert.equal(attempts, 3);
});

test('capture retry immediately preserves unrelated failures', async () => {
  const retryKnownCaptureError = requiredRetry();
  let attempts = 0;
  await assert.rejects(
    retryKnownCaptureError(async () => {
      attempts += 1;
      throw new Error('renderer destroyed');
    }, { wait: async () => {} }),
    /renderer destroyed/
  );
  assert.equal(attempts, 1);
});
