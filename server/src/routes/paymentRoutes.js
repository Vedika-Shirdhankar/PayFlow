const express = require('express');
const router = express.Router();
const {
  createPayment,
  getPayments,
  getPaymentById,
  getPaymentTrace,
  updatePaymentNote,
} = require('../controllers/paymentController');
const { requestRefund, getRefundForPayment } = require('../controllers/refundController');
const { authenticateToken } = require('../middleware/auth');

router.post('/', authenticateToken, createPayment);
router.get('/', authenticateToken, getPayments);
router.get('/:paymentId', authenticateToken, getPaymentById);
router.get('/:paymentId/trace', authenticateToken, getPaymentTrace);
router.patch('/:paymentId/note', authenticateToken, updatePaymentNote);
router.post('/:paymentId/refund', authenticateToken, requestRefund);
router.get('/:paymentId/refund', authenticateToken, getRefundForPayment);

module.exports = router;
