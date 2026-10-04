const { UnrecoverableError } = require('bullmq');

class PaymentProcessingError extends Error {
  constructor(message, code = 'PAYMENT_ERROR', isRetryable = true, details = {}) {
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
    this.status = 400;
  }
}

class ValidationError extends UnrecoverableError {
  constructor(message = 'Validation failed', details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.isRetryable = false;
    this.details = details;
    this.status = 400;
  }
}

class PaymentNotFoundError extends UnrecoverableError {
  constructor(message = 'Payment record not found', details = {}) {
    super(message);
    this.name = 'PaymentNotFoundError';
    this.code = 'PAYMENT_NOT_FOUND';
    this.isRetryable = false;
    this.details = details;
    this.status = 404;
  }
}

class RecipientNotFoundError extends UnrecoverableError {
  constructor(message = 'Recipient wallet or user not found', details = {}) {
    super(message);
    this.name = 'RecipientNotFoundError';
    this.code = 'RECIPIENT_NOT_FOUND';
    this.isRetryable = false;
    this.details = details;
    this.status = 404;
  }
}

class InvalidPaymentStateError extends UnrecoverableError {
  constructor(message = 'Invalid payment state for processing', details = {}) {
    super(message);
    this.name = 'InvalidPaymentStateError';
    this.code = 'INVALID_PAYMENT_STATE';
    this.isRetryable = false;
    this.details = details;
    this.status = 409;
  }
}

// Transient / Retryable Errors
class SimulatedFailureError extends PaymentProcessingError {
  constructor(message = 'Controlled worker failure simulation triggered before transaction commit', details = {}) {
    super(message, 'SIMULATED_FAILURE', true, details);
    this.name = 'SimulatedFailureError';
    this.status = 500;
  }
}

class DatabaseTransientError extends PaymentProcessingError {
  constructor(message = 'Database transient error occurred', details = {}) {
    super(message, 'DATABASE_ERROR', true, details);
    this.name = 'DatabaseTransientError';
    this.status = 503;
  }
}

class NetworkTransientError extends PaymentProcessingError {
  constructor(message = 'Network timeout or communication failure', details = {}) {
    super(message, 'NETWORK_ERROR', true, details);
    this.name = 'NetworkTransientError';
    this.status = 504;
  }
}

class TimeoutTransientError extends PaymentProcessingError {
  constructor(message = 'Dependency or execution timeout occurred', details = {}) {
    super(message, 'TIMEOUT', true, details);
    this.name = 'TimeoutTransientError';
    this.status = 504;
  }
}

class CircuitOpenError extends PaymentProcessingError {
  constructor(message = 'Circuit Breaker is OPEN. Downstream dependency is unavailable.', details = {}) {
    super(message, 'CIRCUIT_OPEN', true, details);
    this.name = 'CircuitOpenError';
    this.status = 503;
  }
}

class InfrastructureOutageError extends PaymentProcessingError {
  constructor(message = 'Infrastructure outage detected', details = {}) {
    super(message, 'INFRASTRUCTURE_OUTAGE', true, details);
    this.name = 'InfrastructureOutageError';
    this.status = 503;
  }
}

class ServerTransientError extends PaymentProcessingError {
  constructor(message = 'Internal server or API service failure', details = {}) {
    super(message, 'SERVER_ERROR', true, details);
    this.name = 'ServerTransientError';
    this.status = 500;
  }
}

/**
 * Helper to detect network disconnections, DNS failures, or MongoDB connection drops
 */
const isNetworkOrDbConnectionError = (err) => {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  const name = err.name || '';

  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    name === 'MongoNetworkError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongooseServerSelectionError' ||
    msg.includes('enotfound') ||
    msg.includes('buffering timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('topology was closed') ||
    msg.includes('could not connect to any servers')
  );
};

/**
 * Classify error object into a clean structured format for UI and logs.
 */
const classifyError = (err) => {
  if (!err) {
    return {
      category: 'UNKNOWN',
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      status: 500,
      isRetryable: false,
    };
  }

  if (isNetworkOrDbConnectionError(err)) {
    return {
      category: 'NETWORK',
      code: 'NETWORK_ERROR',
      message: `Network Error: ${err.message || 'Connection lost to database/server'}`,
      status: 504,
      isRetryable: true,
    };
  }

  let code = err.code || 'INTERNAL_ERROR';
  let category = 'GENERAL';
  let status = err.status || 500;
  let isRetryable = err.isRetryable !== undefined ? err.isRetryable : !(err instanceof UnrecoverableError);

  if (err instanceof InsufficientBalanceError || code === 'INSUFFICIENT_BALANCE') {
    category = 'BUSINESS_RULE';
    code = 'INSUFFICIENT_BALANCE';
    status = 400;
    isRetryable = false;
  } else if (err instanceof ValidationError || code === 'VALIDATION_ERROR') {
    category = 'VALIDATION';
    code = 'VALIDATION_ERROR';
    status = 400;
    isRetryable = false;
  } else if (err instanceof PaymentNotFoundError || code === 'PAYMENT_NOT_FOUND') {
    category = 'NOT_FOUND';
    code = 'PAYMENT_NOT_FOUND';
    status = 404;
    isRetryable = false;
  } else if (err instanceof RecipientNotFoundError || code === 'RECIPIENT_NOT_FOUND') {
    category = 'NOT_FOUND';
    code = 'RECIPIENT_NOT_FOUND';
    status = 404;
    isRetryable = false;
  } else if (err instanceof InvalidPaymentStateError || code === 'INVALID_PAYMENT_STATE') {
    category = 'CONFLICT';
    code = 'INVALID_PAYMENT_STATE';
    status = 409;
    isRetryable = false;
  } else if (err instanceof NetworkTransientError || code === 'NETWORK_ERROR') {
    category = 'NETWORK';
    code = 'NETWORK_ERROR';
    status = 504;
    isRetryable = true;
  } else if (err instanceof DatabaseTransientError || code === 'DATABASE_ERROR') {
    category = 'DATABASE';
    code = 'DATABASE_ERROR';
    status = 503;
    isRetryable = true;
  } else if (err instanceof TimeoutTransientError || code === 'TIMEOUT') {
    category = 'TIMEOUT';
    code = 'TIMEOUT';
    status = 504;
    isRetryable = true;
  } else if (err instanceof CircuitOpenError || code === 'CIRCUIT_OPEN') {
    category = 'CIRCUIT_BREAKER';
    code = 'CIRCUIT_OPEN';
    status = 503;
    isRetryable = true;
  } else if (err instanceof InfrastructureOutageError || code === 'INFRASTRUCTURE_OUTAGE') {
    category = 'INFRASTRUCTURE';
    code = 'INFRASTRUCTURE_OUTAGE';
    status = 503;
    isRetryable = true;
  } else if (err instanceof SimulatedFailureError || code === 'SIMULATED_FAILURE') {
    category = 'SIMULATION';
    code = 'SIMULATED_FAILURE';
    status = 500;
    isRetryable = true;
  }

  return {
    category,
    code,
    message: err.message || 'Processing error',
    status,
    isRetryable,
  };
};

/**
 * Decide whether a BullMQ job failure is terminal (no further retries).
 */
const isTerminalFailure = (err, job) => {
  if (isNetworkOrDbConnectionError(err)) return false; // Network drops are transient outages, not terminal business failures
  if (err instanceof UnrecoverableError) return true;
  if (err && err.isRetryable === false) return true;
  if (/stalled more than allowable limit/i.test((err && err.message) || '')) return true;
  const max = (job && job.opts && job.opts.attempts) || 1;
  return ((job && job.attemptsMade) || 0) >= max;
};

module.exports = {
  isNetworkOrDbConnectionError,
  isTerminalFailure,
  classifyError,
  PaymentProcessingError,
  InsufficientBalanceError,
  ValidationError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  InvalidPaymentStateError,
  SimulatedFailureError,
  DatabaseTransientError,
  NetworkTransientError,
  TimeoutTransientError,
  CircuitOpenError,
  InfrastructureOutageError,
  ServerTransientError,
};
