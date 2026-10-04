const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTerminalFailure,
  InsufficientBalanceError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  InvalidPaymentStateError,
  ValidationError,
  SimulatedFailureError,
  DatabaseTransientError,
} = require('../src/utils/errors');

const job = (attemptsMade, attempts = 3) => ({ attemptsMade, opts: { attempts } });

test('every non-retryable error class is terminal on the first attempt', () => {
  for (const Err of [
    InsufficientBalanceError,
    PaymentNotFoundError,
    RecipientNotFoundError,
    InvalidPaymentStateError,
    ValidationError,
  ]) {
    assert.equal(isTerminalFailure(new Err(), job(1)), true, Err.name);
  }
});

test('retryable errors are only terminal once attempts are exhausted', () => {
  for (const Err of [SimulatedFailureError, DatabaseTransientError]) {
    assert.equal(isTerminalFailure(new Err(), job(1)), false);
    assert.equal(isTerminalFailure(new Err(), job(2)), false);
    assert.equal(isTerminalFailure(new Err(), job(3)), true);
  }
});

test('BullMQ stalled-job failures are terminal', () => {
  assert.equal(isTerminalFailure(new Error('job stalled more than allowable limit'), job(1)), true);
});

test('generic errors retry until exhausted', () => {
  assert.equal(isTerminalFailure(new Error('boom'), job(1)), false);
  assert.equal(isTerminalFailure(new Error('boom'), job(3)), true);
});
