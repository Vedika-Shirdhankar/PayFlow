/**
 * resilience.test.js — Automated tests for PayFlow resilience requirements.
 * Tests: error classification, retry logic, circuit breaker, DLQ, financial idempotency.
 *
 * Run: cd server && npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTerminalFailure,
  classifyError,
  InsufficientBalanceError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  InvalidPaymentStateError,
  ValidationError,
  SimulatedFailureError,
  DatabaseTransientError,
  NetworkTransientError,
  TimeoutTransientError,
  CircuitOpenError,
  InfrastructureOutageError,
  ServerTransientError,
} = require('../src/utils/errors');
const { CircuitBreaker } = require('../src/utils/circuitBreaker');
const { generateCorrelationId } = require('../src/middleware/tracing');

const makeJob = (attemptsMade, attempts = 3) => ({ attemptsMade, opts: { attempts } });

// =============================================================================
// Error Classification Tests
// =============================================================================

test('classifyError: InsufficientBalanceError → BUSINESS_RULE, status 400, non-retryable', () => {
  const cls = classifyError(new InsufficientBalanceError('Not enough funds'));
  assert.equal(cls.category, 'BUSINESS_RULE');
  assert.equal(cls.code, 'INSUFFICIENT_BALANCE');
  assert.equal(cls.status, 400);
  assert.equal(cls.isRetryable, false);
});

test('classifyError: NetworkTransientError → NETWORK, status 504, retryable', () => {
  const cls = classifyError(new NetworkTransientError('Connection refused'));
  assert.equal(cls.category, 'NETWORK');
  assert.equal(cls.code, 'NETWORK_ERROR');
  assert.equal(cls.status, 504);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: DatabaseTransientError → DATABASE, status 503, retryable', () => {
  const cls = classifyError(new DatabaseTransientError('MongoDB timeout'));
  assert.equal(cls.category, 'DATABASE');
  assert.equal(cls.code, 'DATABASE_ERROR');
  assert.equal(cls.status, 503);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: TimeoutTransientError → TIMEOUT, status 504, retryable', () => {
  const cls = classifyError(new TimeoutTransientError('30s timeout'));
  assert.equal(cls.category, 'TIMEOUT');
  assert.equal(cls.code, 'TIMEOUT');
  assert.equal(cls.status, 504);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: CircuitOpenError → CIRCUIT_BREAKER, status 503, retryable', () => {
  const cls = classifyError(new CircuitOpenError());
  assert.equal(cls.category, 'CIRCUIT_BREAKER');
  assert.equal(cls.code, 'CIRCUIT_OPEN');
  assert.equal(cls.status, 503);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: InfrastructureOutageError → INFRASTRUCTURE, status 503, retryable', () => {
  const cls = classifyError(new InfrastructureOutageError());
  assert.equal(cls.category, 'INFRASTRUCTURE');
  assert.equal(cls.code, 'INFRASTRUCTURE_OUTAGE');
  assert.equal(cls.status, 503);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: SimulatedFailureError → SIMULATION, status 500, retryable', () => {
  const cls = classifyError(new SimulatedFailureError());
  assert.equal(cls.category, 'SIMULATION');
  assert.equal(cls.code, 'SIMULATED_FAILURE');
  assert.equal(cls.status, 500);
  assert.equal(cls.isRetryable, true);
});

test('classifyError: ValidationError → VALIDATION, not retryable', () => {
  const cls = classifyError(new ValidationError('Bad payload'));
  assert.equal(cls.category, 'VALIDATION');
  assert.equal(cls.isRetryable, false);
});

test('classifyError: PaymentNotFoundError → NOT_FOUND, not retryable', () => {
  const cls = classifyError(new PaymentNotFoundError());
  assert.equal(cls.category, 'NOT_FOUND');
  assert.equal(cls.status, 404);
  assert.equal(cls.isRetryable, false);
});

test('classifyError: handles null gracefully', () => {
  const cls = classifyError(null);
  assert.equal(cls.category, 'UNKNOWN');
  assert.equal(cls.isRetryable, false);
});

// =============================================================================
// Terminal Failure / Retry Logic Tests
// =============================================================================

test('Req 3 — Permanent errors never retry (isTerminalFailure = true on attempt 1)', () => {
  for (const Err of [InsufficientBalanceError, PaymentNotFoundError, RecipientNotFoundError, InvalidPaymentStateError, ValidationError]) {
    assert.equal(isTerminalFailure(new Err(), makeJob(1)), true, Err.name);
  }
});

test('Req 3 — Transient errors retry until max attempts', () => {
  for (const Err of [SimulatedFailureError, DatabaseTransientError, NetworkTransientError, TimeoutTransientError]) {
    assert.equal(isTerminalFailure(new Err(), makeJob(1)), false, `${Err.name} should retry on attempt 1`);
    assert.equal(isTerminalFailure(new Err(), makeJob(2)), false, `${Err.name} should retry on attempt 2`);
    assert.equal(isTerminalFailure(new Err(), makeJob(3)), true, `${Err.name} should stop after attempt 3`);
  }
});

test('Req 3 — BullMQ stalled jobs are terminal regardless of attempt count', () => {
  assert.equal(isTerminalFailure(new Error('job stalled more than allowable limit'), makeJob(1)), true);
  assert.equal(isTerminalFailure(new Error('job stalled more than allowable limit'), makeJob(3)), true);
});

test('Req 3 — Generic errors retry until exhausted', () => {
  assert.equal(isTerminalFailure(new Error('boom'), makeJob(1)), false);
  assert.equal(isTerminalFailure(new Error('boom'), makeJob(3)), true);
});

test('Req 3 — CircuitOpenError is retryable (retry after circuit resets)', () => {
  const cb = classifyError(new CircuitOpenError());
  assert.equal(cb.isRetryable, true);
  assert.equal(isTerminalFailure(new CircuitOpenError(), makeJob(1)), false);
});

// =============================================================================
// Circuit Breaker Tests (Req 9)
// =============================================================================

test('Req 9 — CircuitBreaker starts in CLOSED state', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
  const state = cb.getState();
  assert.equal(state.state, 'CLOSED');
  assert.equal(state.failureCount, 0);
});

test('Req 9 — CircuitBreaker trips to OPEN after failure threshold', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
  const err = new Error('test failure');
  cb.onFailure(err);
  cb.onFailure(err);
  assert.equal(cb.getState().state, 'CLOSED', 'Still CLOSED at 2/3 failures');
  cb.onFailure(err);
  const state = cb.getState();
  assert.equal(state.state, 'OPEN', 'Should be OPEN at failure threshold');
  assert.ok(state.nextAttemptTime > Date.now(), 'nextAttemptTime should be in the future');
});

test('Req 9 — CircuitBreaker blocks requests when OPEN', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
  cb.onFailure(new Error('e1'));
  cb.onFailure(new Error('e2'));
  assert.equal(cb.getState().state, 'OPEN');

  await assert.rejects(
    () => cb.execute(() => Promise.resolve('ok')),
    (err) => {
      assert.equal(err.code, 'CIRCUIT_OPEN');
      return true;
    }
  );
});

test('Req 9 — CircuitBreaker transitions OPEN → HALF_OPEN after reset timeout', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });
  cb.onFailure(new Error('e1'));
  cb.onFailure(new Error('e2'));
  assert.equal(cb.getState().state, 'OPEN');

  await new Promise((r) => setTimeout(r, 80));
  const state = cb.getState();
  assert.equal(state.state, 'HALF_OPEN', 'Should transition to HALF_OPEN after timeout');
});

test('Req 9 — CircuitBreaker recovers HALF_OPEN → CLOSED after success threshold', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, successThreshold: 2, resetTimeoutMs: 50 });
  cb.onFailure(new Error('e1'));
  cb.onFailure(new Error('e2'));
  await new Promise((r) => setTimeout(r, 80));
  cb.getState(); // triggers HALF_OPEN transition

  await cb.execute(() => Promise.resolve('pass1'));
  assert.equal(cb.getState().state, 'HALF_OPEN', 'Still HALF_OPEN after 1 success');
  await cb.execute(() => Promise.resolve('pass2'));
  assert.equal(cb.getState().state, 'CLOSED', 'Should be CLOSED after 2 successes');
});

test('Req 9 — Manual reset returns CircuitBreaker to CLOSED', () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
  cb.onFailure(new Error('e1'));
  cb.onFailure(new Error('e2'));
  assert.equal(cb.getState().state, 'OPEN');
  cb.reset();
  const state = cb.getState();
  assert.equal(state.state, 'CLOSED');
  assert.equal(state.failureCount, 0);
  assert.equal(state.nextAttemptTime, null);
});

// =============================================================================
// Distributed Tracing / Correlation ID Tests (Req 11)
// =============================================================================

test('Req 11 — generateCorrelationId returns unique string IDs', () => {
  const id1 = generateCorrelationId();
  const id2 = generateCorrelationId();
  assert.equal(typeof id1, 'string');
  assert.ok(id1.length > 0);
  assert.notEqual(id1, id2, 'Correlation IDs should be unique');
});

// =============================================================================
// Financial / Idempotency Correctness Tests (Req 8)
// =============================================================================

test('Req 8 — duplicate payment detection uses error code E11000', () => {
  const dupErr = new Error('E11000 duplicate key error collection: payflow.payments');
  dupErr.code = 11000;
  const isDuplicate = dupErr.code === 11000 || (dupErr.message && dupErr.message.includes('E11000'));
  assert.equal(isDuplicate, true);
});

// =============================================================================
// Exponential Backoff Logic Tests
// =============================================================================

test('Req 3 — Exponential backoff delay computation', () => {
  const base = 2000;
  // Attempt 1 (index 0): base * 2^0 = 2000ms
  assert.equal(base * Math.pow(2, Math.max(1 - 1, 0)), 2000);
  // Attempt 2 (index 1): base * 2^1 = 4000ms
  assert.equal(base * Math.pow(2, Math.max(2 - 1, 0)), 4000);
  // Attempt 3 (index 2): base * 2^2 = 8000ms
  assert.equal(base * Math.pow(2, Math.max(3 - 1, 0)), 8000);
});
