const MAX_AMOUNT = Number(process.env.MAX_PAYMENT_AMOUNT) || 100000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a payment amount: finite, > 0, <= MAX_AMOUNT, max 2 decimal places.
 * Returns { ok: true, value } or { ok: false, error }.
 */
const parseAmount = (raw, max = MAX_AMOUNT) => {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'Amount is required' };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'Payment amount must be greater than 0' };
  }
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    return { ok: false, error: 'Payment amount cannot have more than 2 decimal places' };
  }
  if (n > max) {
    return { ok: false, error: `Payment amount cannot exceed $${max}` };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
};

const validateIdempotencyKey = (key) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return { ok: false, error: 'idempotencyKey must be a non-empty string' };
  }
  if (key.length > 128) {
    return { ok: false, error: 'idempotencyKey must be 128 characters or fewer' };
  }
  return { ok: true, value: key.trim() };
};

const validateEmail = (email) =>
  typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters long' };
  }
  if (password.length > 72) {
    return { ok: false, error: 'Password must be 72 characters or fewer' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: 'Password must contain at least one letter and one number' };
  }
  return { ok: true };
};

const validateName = (name) =>
  typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80;

module.exports = {
  MAX_AMOUNT,
  parseAmount,
  validateIdempotencyKey,
  validateEmail,
  validatePassword,
  validateName,
};
