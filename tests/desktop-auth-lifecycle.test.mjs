import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuitGate } from '../electron/auth-lifecycle.mjs';

test('normal quit waits for persistence then resumes once without recursion', async () => {
  let release, quit = 0, prevented = 0;
  const gate = createQuitGate({ finish: () => new Promise(resolve => { release = resolve; }), quit: () => { quit++; }, onFailure: () => assert.fail('unexpected failure') });
  gate({ preventDefault: () => { prevented++; } });
  await Promise.resolve();
  gate({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2);
  assert.equal(quit, 0);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quit, 1);
  gate({ preventDefault: () => assert.fail('final quit must be allowed') });
});

test('failed persistence keeps the process alive and permits an explicit retry', async () => {
  let attempts = 0, failures = 0, quit = 0;
  const gate = createQuitGate({ finish: async () => { if (++attempts === 1) throw new Error('locked'); },
    quit: () => { quit++; }, onFailure: () => { failures++; } });
  gate({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failures, 1);
  assert.equal(quit, 0);
  gate({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quit, 1);
});
