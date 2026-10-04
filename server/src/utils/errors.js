const { UnrecoverableError } = require('bullmq');

class PaymentProcessingError extends Error {
  constructor(message, code, isRetryable = true, details = {}) {
    super(message);
    this.name = 'PaymentProcessingError';
    this.code = code;
    this.isRetryable = isRetryable;
    this.details = details;
  }
}

// Permanent / Non-retryable Errors (Inherit from UnrecoverableError or flagged isRetryable = false)
class InsufficientBalanceError extends UnrecoverableError {
  constructor(message = 'Insufficient wallet balance', details = {}) {
    super(message);
    this.name = 'InsufficientBalanceError';
    this.code = 'INSUFFICIENT_BALANCE';
    this.isRetryable = false;
    this.details = details;
  }
}

class ValidationError extends UnrecoverableError {
  constructor(message = 'Validation failed', details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.isRetryable = false;
    this.details = details;
  }
}

class PaymentNotFoundError extends UnrecoverableError {
  constructor(message = 'Payment record not found', details = {}) {
    super(message);
    this.name = 'PaymentNotFoundError';
    this.code = 'PAYMENT_NOT_FOUND';
    this.isRetryable = false;
    this.details = details;
  }
}

class RecipientNotFoundError extends UnrecoverableError {
  constructor(message = 'Recipient wallet or user not found', details = {}) {
    super(message);
    this.name = 'RecipientNotFoundError';
    this.code = 'RECIPIENT_NOT_FOUND';
    this.isRetryable = false;
    this.details = details;
  }
}

class InvalidPaymentStateError extends UnrecoverableError {
  constructor(message = 'Invalid payment state for processing', details = {}) {
    super(message);
    this.name = 'InvalidPaymentStateError';
    this.code = 'INVALID_PAYMENT_STATE';
    this.isRetryable = false;
    this.details = details;
  }
}

// Transient / Retryable Errors
class SimulatedFailureError extends PaymentProcessingError {
  constructor(message = 'Controlled worker failure simulation triggered before transaction commit', details = {}) {
    super(message, 'SIMULATED_FAILURE', true, details);
    this.name = 'SimulatedFailureError';
  }
}

class DatabaseTransientError extends PaymentProcessingError {
  constructor(message = 'Database transient error occurred', details = {}) {
    super(message, 'DATABASE_ERROR', true, details);
    this.name = 'DatabaseTransientError';
  }
}

class NetworkTransientError extends PaymentProcessingError {
  constructor(message = 'Network timeout or communication failure', details = {}) {
    super(message, 'NETWORK_ERROR', true, details);
    this.name = 'NetworkTransientError';
  }
}

/**
 * Decide whether a BullMQ job failure is terminal (no further retries).
 * - UnrecoverableError subclasses (insufficient balance, validation, not found, ...)
 * - BullMQ "stalled more than allowable limit" failures
 * - attempts exhausted
 */
const isTerminalFailure = (err, job) => {
  if (err instanceof UnrecoverableError) return true;
  if (/stalled more than allowable limit/i.test((err && err.message) || '')) return true;
  const max = (job && job.opts && job.opts.attempts) || 1;
  return ((job && job.attemptsMade) || 0) >= max;
};

module.exports = {
  isTerminalFailure,
  PaymentProcessingError,
  InsufficientBalanceError,
  ValidationError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  InvalidPaymentStateError,
  SimulatedFailureError,
  DatabaseTransientError,
  NetworkTransientError,
};
