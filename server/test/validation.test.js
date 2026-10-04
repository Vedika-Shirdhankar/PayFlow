const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAmount,
  validateIdempotencyKey,
  validateEmail,
  validatePassword,
  validateName,
} = require('../src/utils/validation');

test('parseAmount accepts valid amounts and rounds to cents', () => {
  assert.deepEqual(parseAmount('10'), { ok: true, value: 10 });
  assert.deepEqual(parseAmount(12.5), { ok: true, value: 12.5 });
  assert.deepEqual(parseAmount('0.01'), { ok: true, value: 0.01 });
  assert.deepEqual(parseAmount(0.1 + 0.2), { ok: true, value: 0.3 }); // float noise is normalised
});

test('parseAmount rejects bad input', () => {
  for (const bad of [0, -5, 'abc', NaN, Infinity, '', null, undefined, 1.999, 1e9]) {
    assert.equal(parseAmount(bad).ok, false, `should reject ${String(bad)}`);
  }
  assert.equal(parseAmount(100001, 100000).ok, false);
  assert.equal(parseAmount(100000, 100000).ok, true);
});

test('validateIdempotencyKey', () => {
  assert.equal(validateIdempotencyKey('KEY-123').ok, true);
  assert.equal(validateIdempotencyKey('  ').ok, false);
  assert.equal(validateIdempotencyKey(123).ok, false);
  assert.equal(validateIdempotencyKey('x'.repeat(129)).ok, false);
  assert.equal(validateIdempotencyKey(' abc ').value, 'abc');
});

test('validateEmail / validateName', () => {
  assert.equal(validateEmail('alice@payflow.com'), true);
  assert.equal(validateEmail('not-an-email'), false);
  assert.equal(validateEmail(undefined), false);
  assert.equal(validateName('Al'), true);
  assert.equal(validateName('A'), false);
});

test('validatePassword enforces length and mix', () => {
  assert.equal(validatePassword('User@123').ok, true);
  assert.equal(validatePassword('short1').ok, false);
  assert.equal(validatePassword('onlyletters').ok, false);
  assert.equal(validatePassword('12345678').ok, false);
  assert.equal(validatePassword('a1'.repeat(40)).ok, false);
});
