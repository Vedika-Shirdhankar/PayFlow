const EventEmitter = require('events');

class CircuitBreaker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 3;
    this.successThreshold = options.successThreshold || 2;
    this.resetTimeoutMs = options.resetTimeoutMs || 10000;

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = new Date();
    this.nextAttemptTime = null;
    this.lastError = null;
  }

  getState() {
    // Check if OPEN state timer expired -> transition to HALF_OPEN
    if (this.state === 'OPEN' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      this.lastStateChange = new Date();
      this.emit('stateChange', { name: this.name, state: this.state, reason: 'Reset timeout expired' });
    }

    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      successCount: this.successCount,
      successThreshold: this.successThreshold,
      resetTimeoutMs: this.resetTimeoutMs,
      lastStateChange: this.lastStateChange,
      nextAttemptTime: this.nextAttemptTime,
      lastError: this.lastError ? this.lastError.message : null,
    };
  }

  async execute(fn) {
    const currentStats = this.getState();
    if (currentStats.state === 'OPEN') {
      const waitMs = Math.max(0, this.nextAttemptTime - Date.now());
      const err = new Error(`Circuit Breaker '${this.name}' is OPEN. Requests blocked for ${Math.ceil(waitMs / 1000)}s.`);
      err.code = 'CIRCUIT_OPEN';
      err.isRetryable = true;
      throw err;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount += 1;
      if (this.successCount >= this.successThreshold) {
        this.reset();
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
      this.lastError = null;
    }
  }

  onFailure(err) {
    this.failureCount += 1;
    this.lastError = err;

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.trip(err);
    }
  }

  trip(err) {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
    this.lastStateChange = new Date();
    this.emit('stateChange', { name: this.name, state: this.state, error: err ? err.message : null });
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    this.lastError = null;
    this.lastStateChange = new Date();
    this.emit('stateChange', { name: this.name, state: this.state, reason: 'Circuit recovered' });
  }
}

// Singleton instances for dependencies
const paymentWorkerCircuit = new CircuitBreaker({
  name: 'PaymentWorkerCircuit',
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 10000,
});

const databaseCircuit = new CircuitBreaker({
  name: 'DatabaseCircuit',
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 15000,
});

module.exports = {
  CircuitBreaker,
  paymentWorkerCircuit,
  databaseCircuit,
};
