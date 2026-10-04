const express = require('express');
const router = express.Router();
const {
  createPayment,
  getPayments,
  getPaymentById,
  getPaymentTrace,
} = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

router.post('/', authenticateToken, createPayment);
router.get('/', authenticateToken, getPayments);
router.get('/:paymentId', authenticateToken, getPaymentById);
router.get('/:paymentId/trace', authenticateToken, getPaymentTrace);

module.exports = router;
