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
  getDLQ,
  replayPayment,
} = require('../controllers/adminController');
const { adminWalletAdjustment } = require('../controllers/walletController');
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

module.exports = router;
