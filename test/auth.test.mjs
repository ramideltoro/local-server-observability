import test from "node:test";import assert from "node:assert/strict";import {safeReturn} from "../server/google-auth.mjs";


test('PriceDip broker accepts only a fixed, browser-bound return path', () => {
  const state='a'.repeat(43);
  assert.equal(safeReturn('/auth/pricedip?state='+state),'/auth/pricedip?state='+state);
  assert.equal(safeReturn('/auth/pricedip?state='+state+'&redirect=https://evil.example'),'/owner/');
  assert.equal(safeReturn('//evil.example/auth/pricedip?state='+state),'/owner/');
});
