const express = require('express');
const router = express.Router();
const {
  requestRefund,
  getRefundForPayment,
  getUserRefunds,
} = require('../controllers/refundController');
const { authenticateToken } = require('../middleware/auth');

// User: view own refunds list
router.get('/', authenticateToken, getUserRefunds);

// These are also mounted under /payments/:paymentId via paymentRoutes
// but we expose a shortcut here too
module.exports = router;
