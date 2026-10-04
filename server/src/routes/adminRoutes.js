const express = require('express');
const router = express.Router();
const {
  getStats,
  getUsers,
  getAdminPayments,
  getAuditLogs,
  getQueueHealth,
  getWorkersStatus,
  getSystemConfig,
  updateSystemConfig,
  toggleFaultSimulation,
  triggerSimulation,
  clearAllSimulations,
  getDatabaseHealthEndpoint,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  getDLQ,
  replayPayment,
  getSystemTopology,
} = require('../controllers/adminController');
const { adminWalletAdjustment } = require('../controllers/walletController');
const { getAllRefunds, approveRefund, rejectRefund } = require('../controllers/refundController');
const TransactionLimit = require('../models/TransactionLimit');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.get('/stats', authenticateToken, requireAdmin, getStats);
router.get('/users', authenticateToken, requireAdmin, getUsers);
router.get('/payments', authenticateToken, requireAdmin, getAdminPayments);
router.get('/audit-logs', authenticateToken, requireAdmin, getAuditLogs);
router.get('/queue-health', authenticateToken, requireAdmin, getQueueHealth);
router.get('/workers', authenticateToken, requireAdmin, getWorkersStatus);

// DLQ and Payment Replay Endpoints
router.get('/dlq', authenticateToken, requireAdmin, getDLQ);
router.post('/payments/:paymentId/replay', authenticateToken, requireAdmin, replayPayment);
router.post('/dlq/:paymentId/replay', authenticateToken, requireAdmin, replayPayment);

// Admin Wallet Adjustment
router.post('/wallet-adjustment', authenticateToken, requireAdmin, adminWalletAdjustment);

// System Configuration & Fault Simulation Endpoints
router.get('/config', authenticateToken, requireAdmin, getSystemConfig);
router.post('/config', authenticateToken, requireAdmin, updateSystemConfig);
router.post('/toggle-fault', authenticateToken, requireAdmin, toggleFaultSimulation);
router.post('/simulate-failure', authenticateToken, requireAdmin, toggleFaultSimulation);

// Advanced failure simulation control
router.post('/simulations/trigger', authenticateToken, requireAdmin, triggerSimulation);
router.post('/simulations/clear', authenticateToken, requireAdmin, clearAllSimulations);

// Database health monitoring
router.get('/db-health', authenticateToken, requireAdmin, getDatabaseHealthEndpoint);

// Circuit breaker
router.get('/circuit-breaker', authenticateToken, requireAdmin, getCircuitBreakerStatus);
router.post('/circuit-breaker/reset', authenticateToken, requireAdmin, resetCircuitBreaker);

// Live System Topology Map
router.get('/topology', authenticateToken, requireAdmin, getSystemTopology);

// Refund Management (Admin)
router.get('/refunds', authenticateToken, requireAdmin, getAllRefunds);
router.post('/refunds/:refundId/approve', authenticateToken, requireAdmin, approveRefund);
router.post('/refunds/:refundId/reject', authenticateToken, requireAdmin, rejectRefund);

// User Transaction Limit Management (Admin)
router.get('/users/:userId/limits', authenticateToken, requireAdmin, async (req, res) => {
  try {
    let limits = await TransactionLimit.findOne({ userId: req.params.userId });
    if (!limits) limits = { perPaymentLimit: 0, dailyLimit: 0 };
    return res.json({ perPaymentLimit: limits.perPaymentLimit, dailyLimit: limits.dailyLimit });
  } catch (e) { return res.status(500).json({ error: 'Failed to fetch limits' }); }
});
router.put('/users/:userId/limits', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { perPaymentLimit, dailyLimit } = req.body;
    const update = {};
    if (perPaymentLimit !== undefined) update.perPaymentLimit = Math.max(0, Number(perPaymentLimit));
    if (dailyLimit !== undefined) update.dailyLimit = Math.max(0, Number(dailyLimit));
    const limits = await TransactionLimit.findOneAndUpdate(
      { userId: req.params.userId }, { $set: update }, { upsert: true, new: true }
    );
    return res.json({ message: 'Limits updated', perPaymentLimit: limits.perPaymentLimit, dailyLimit: limits.dailyLimit });
  } catch (e) { return res.status(500).json({ error: 'Failed to update limits' }); }
});

module.exports = router;
