import assert from 'node:assert/strict';
import test from 'node:test';
import { linkClonedFingerprintAction } from '../site/assets/responsive-ui.js';

test('cloned fingerprint action routes to the canonical Identify song control', () => {
  const attributes = new Map();
  const button = {
    setAttribute(name, value) { attributes.set(name, value); }
  };
  const clone = {
    querySelector(selector) {
      assert.equal(selector, '#metadata-fingerprint-btn');
      return button;
    }
  };

  assert.equal(linkClonedFingerprintAction(clone), true);
  assert.equal(attributes.get('data-click-id'), 'metadata-fingerprint-btn');
});
