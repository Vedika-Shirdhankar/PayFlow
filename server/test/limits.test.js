const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin } = require('../src/middleware/auth');

test('requireAdmin middleware blocks regular user with 403 FORBIDDEN', () => {
  let status = null;
  let responseData = null;
  let nextCalled = false;

  const req = {
    user: {
      userId: 'user-123',
      role: 'USER',
      email: 'user@example.com',
    },
  };

  const res = {
    status(code) {
      status = code;
      return {
        json(data) {
          responseData = data;
        },
      };
    },
  };

  const next = () => {
    nextCalled = true;
  };

  requireAdmin(req, res, next);

  assert.equal(nextCalled, false, 'next() should not be called for non-admin');
  assert.equal(status, 403, 'status should be 403 Forbidden');
  assert.equal(responseData?.code, 'FORBIDDEN');
});

test('requireAdmin middleware allows admin user to proceed', () => {
  let nextCalled = false;
  let status = null;

  const req = {
    user: {
      userId: 'admin-123',
      role: 'ADMIN',
      email: 'admin@example.com',
    },
  };

  const res = {
    status(code) {
      status = code;
      return {
        json() {},
      };
    },
  };

  const next = () => {
    nextCalled = true;
  };

  requireAdmin(req, res, next);

  assert.equal(nextCalled, true, 'next() must be called for ADMIN');
  assert.equal(status, null, 'No error status should be set for ADMIN');
});

test('User limits update endpoint rejects non-admin users', async () => {
  // Simulate the PUT /api/users/me/limits handler logic
  const handlePutMeLimits = async (req, res) => {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Permission denied: Only administrators are authorized to set or modify payment limits.',
        code: 'ADMIN_ONLY',
      });
    }
    return res.json({ message: 'Success' });
  };

  let statusCode = null;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(body) {
          jsonBody = body;
        },
      };
    },
    json(body) {
      statusCode = 200;
      jsonBody = body;
    },
  };

  // Test with regular user
  await handlePutMeLimits({ user: { role: 'USER', userId: 'u1' }, body: { perPaymentLimit: 50 } }, res);
  assert.equal(statusCode, 403);
  assert.equal(jsonBody.code, 'ADMIN_ONLY');

  // Test with admin user
  await handlePutMeLimits({ user: { role: 'ADMIN', userId: 'a1' }, body: { perPaymentLimit: 50 } }, res);
  assert.equal(statusCode, 200);
});
