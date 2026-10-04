const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Payment = require('../models/Payment');
const PaymentJob = require('../models/PaymentJob');
const AuditLog = require('../models/AuditLog');
const SystemConfig = require('../models/SystemConfig');
const WorkerHeartbeat = require('../models/WorkerHeartbeat');
const { getQueueStats, getDeadLetterQueue, replayPaymentJob } = require('../queue/paymentQueue');

const getStats = async (req, res) => {
  try {
    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);

    const [
      totalUsers,
      totalWallets,
      totalPayments,
      successfulPayments,
      failedPayments,
      systemConfig,
      allWorkers,
      queueCounts,
    ] = await Promise.all([
      User.countDocuments(),
      Wallet.countDocuments(),
      Payment.countDocuments(),
      Payment.countDocuments({ status: 'SUCCESS' }),
      Payment.countDocuments({ status: 'FAILED' }),
      SystemConfig.findOne({ key: 'DEFAULT_CONFIG' }),
      WorkerHeartbeat.find().sort({ lastHeartbeat: -1 }),
      getQueueStats(),
    ]);

    const onlineWorkers = allWorkers.filter(
      (w) => w.status !== 'OFFLINE' && new Date(w.lastHeartbeat) >= cutoff
    );

    return res.json({
      totalUsers,
      totalWallets,
      totalPayments,
      successfulPayments,
      failedPayments,
      queuedJobs: queueCounts.waiting,
      processingJobs: queueCounts.active,
      retryingJobs: queueCounts.delayed,
      completedJobs: queueCounts.completed,
      failedJobs: queueCounts.failed,
      bullmq: queueCounts,
      faultSimulationActive: systemConfig ? systemConfig.simulateOneFailure : false,
      demoDelayMs: systemConfig ? systemConfig.demoDelayMs : 5000,
      registeredWorkerCount: allWorkers.length,
      onlineWorkerCount: onlineWorkers.length,
      staleWorkerCount: allWorkers.length - onlineWorkers.length,
      workers: allWorkers.map((w) => ({
        workerId: w.workerId,
        processId: w.processId,
        status: new Date(w.lastHeartbeat) < cutoff ? 'OFFLINE' : w.status,
        lastHeartbeat: w.lastHeartbeat,
        currentJobId: w.currentJobId,
        currentPaymentId: w.currentPaymentId,
        currentAttempt: w.currentAttempt,
        startedAt: w.startedAt,
        stoppedAt: w.stoppedAt,
        uptimeMs: Date.now() - new Date(w.startedAt).getTime(),
      })),
    });
  } catch (error) {
    console.error('getStats error:', error);
    return res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
};

const getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
    const wallets = await Wallet.find();

    const walletMap = {};
    wallets.forEach((w) => {
      walletMap[w.userId.toString()] = w;
    });

    const userList = users.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      wallet: walletMap[u._id.toString()]
        ? {
            id: walletMap[u._id.toString()]._id,
            balance: walletMap[u._id.toString()].balance,
            currency: walletMap[u._id.toString()].currency,
          }
        : null,
    }));

    return res.json(userList);
  } catch (error) {
    console.error('getUsers error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
};

const getAdminPayments = async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('senderId', 'name email')
      .populate('recipientId', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json(payments);
  } catch (error) {
    console.error('getAdminPayments error:', error);
    return res.status(500).json({ error: 'Failed to fetch admin payments' });
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const { action } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const query = {};
    if (action) query.action = action;

    const logs = await AuditLog.find(query)
      .populate('actorId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.json(logs);
  } catch (error) {
    console.error('getAuditLogs error:', error);
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

const getQueueHealth = async (req, res) => {
  try {
    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);

    const [queueCounts, allWorkers] = await Promise.all([
      getQueueStats(),
      WorkerHeartbeat.find().sort({ lastHeartbeat: -1 }),
    ]);

    const onlineWorkers = allWorkers.filter(
      (w) => w.status !== 'OFFLINE' && new Date(w.lastHeartbeat) >= cutoff
    );

    return res.json({
      engine: 'Redis + BullMQ',
      queuedCount: queueCounts.waiting,
      processingCount: queueCounts.active,
      retryingCount: queueCounts.delayed,
      successCount: queueCounts.completed,
      failedCount: queueCounts.failed,
      totalJobs: queueCounts.total,
      bullmq: queueCounts,
      registeredWorkerCount: allWorkers.length,
      onlineWorkerCount: onlineWorkers.length,
      staleWorkerCount: allWorkers.length - onlineWorkers.length,
      activeWorkers: onlineWorkers.map((w) => ({
        workerId: w.workerId,
        processId: w.processId,
        status: w.status,
        lastHeartbeat: w.lastHeartbeat,
      })),
    });
  } catch (error) {
    console.error('getQueueHealth error:', error);
    return res.status(500).json({ error: 'Failed to fetch queue health' });
  }
};

const getWorkersStatus = async (req, res) => {
  try {
    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);

    const allWorkers = await WorkerHeartbeat.find().sort({ lastHeartbeat: -1 });

    if (allWorkers.length === 0) {
      return res.json({
        message: 'No worker registered',
        isWorkerOnline: false,
        registeredWorkerCount: 0,
        onlineWorkerCount: 0,
        workers: [],
      });
    }

    const onlineWorkers = allWorkers.filter(
      (w) => w.status !== 'OFFLINE' && new Date(w.lastHeartbeat) >= cutoff
    );

    const workersWithStale = allWorkers.map((w) => {
      const isStale = w.status === 'OFFLINE' || new Date(w.lastHeartbeat) < cutoff;
      return {
        workerId: w.workerId,
        processId: w.processId,
        status: isStale ? 'OFFLINE' : w.status,
        lastHeartbeat: w.lastHeartbeat,
        currentJobId: w.currentJobId,
        currentPaymentId: w.currentPaymentId,
        currentAttempt: w.currentAttempt,
        startedAt: w.startedAt,
        stoppedAt: w.stoppedAt,
        uptimeMs: Date.now() - new Date(w.startedAt).getTime(),
        isStale,
      };
    });

    const activeProcessingJobs = await PaymentJob.find({ status: 'PROCESSING' })
      .populate('paymentId')
      .sort({ lockedAt: -1 });

    const recentWorkerLogs = await AuditLog.find({
      action: { $in: ['WORKER_CLAIMED', 'PROCESSING', 'WORKER_FAILURE', 'RETRY_SCHEDULED', 'SUCCESS', 'FAILED'] },
    })
      .sort({ createdAt: -1 })
      .limit(20);

    const config = await SystemConfig.findOne({ key: 'DEFAULT_CONFIG' });

    return res.json({
      message: onlineWorkers.length > 0 ? 'Worker Online' : 'Worker Offline',
      isWorkerOnline: onlineWorkers.length > 0,
      registeredWorkerCount: allWorkers.length,
      onlineWorkerCount: onlineWorkers.length,
      staleWorkerCount: allWorkers.length - onlineWorkers.length,
      workers: workersWithStale,
      demoDelayMs: config ? config.demoDelayMs : 5000,
      simulateOneFailure: config ? config.simulateOneFailure : false,
      activeProcessingJobs,
      recentWorkerActivity: recentWorkerLogs,
    });
  } catch (error) {
    console.error('getWorkersStatus error:', error);
    return res.status(500).json({ error: 'Failed to fetch workers status' });
  }
};

const getSystemConfig = async (req, res) => {
  try {
    let config = await SystemConfig.findOne({ key: 'DEFAULT_CONFIG' });
    if (!config) {
      config = await SystemConfig.create({
        key: 'DEFAULT_CONFIG',
        demoDelayMs: 5000,
        simulateOneFailure: false,
      });
    }

    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);
    const allWorkers = await WorkerHeartbeat.find().sort({ lastHeartbeat: -1 });
    const onlineWorkers = allWorkers.filter(
      (w) => w.status !== 'OFFLINE' && new Date(w.lastHeartbeat) >= cutoff
    );

    return res.json({
      demoDelayMs: config.demoDelayMs,
      simulateOneFailure: config.simulateOneFailure,
      isWorkerOnline: onlineWorkers.length > 0,
      registeredWorkerCount: allWorkers.length,
      onlineWorkerCount: onlineWorkers.length,
      workers: allWorkers.map((w) => ({
        workerId: w.workerId,
        processId: w.processId,
        status: new Date(w.lastHeartbeat) < cutoff ? 'OFFLINE' : w.status,
        lastHeartbeat: w.lastHeartbeat,
      })),
    });
  } catch (error) {
    console.error('getSystemConfig error:', error);
    return res.status(500).json({ error: 'Failed to fetch system config' });
  }
};

const updateSystemConfig = async (req, res) => {
  try {
    const { demoDelayMs, simulateOneFailure } = req.body;
    const updateData = {};
    if (demoDelayMs !== undefined) {
      const delay = Number(demoDelayMs);
      if (!Number.isFinite(delay) || delay < 0 || delay > 60000) {
        return res.status(400).json({ error: 'demoDelayMs must be a number between 0 and 60000' });
      }
      updateData.demoDelayMs = delay;
    }
    if (simulateOneFailure !== undefined) updateData.simulateOneFailure = Boolean(simulateOneFailure);

    const config = await SystemConfig.findOneAndUpdate(
      { key: 'DEFAULT_CONFIG' },
      { $set: updateData },
      { upsert: true, new: true }
    );

    await AuditLog.create({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'SYSTEM_CONFIG_UPDATE',
      entityType: 'SystemConfig',
      metadata: {
        updatedBy: req.user.email,
        demoDelayMs: config.demoDelayMs,
        simulateOneFailure: config.simulateOneFailure,
      },
    });

    return res.json({
      message: 'System configuration updated successfully',
      config,
    });
  } catch (error) {
    console.error('updateSystemConfig error:', error);
    return res.status(500).json({ error: 'Failed to update system config' });
  }
};

const toggleFaultSimulation = async (req, res) => {
  try {
    const { enabled } = req.body;
    let targetState = enabled !== undefined ? Boolean(enabled) : undefined;
    if (targetState === undefined) {
      const current = await SystemConfig.findOne({ key: 'DEFAULT_CONFIG' });
      targetState = !(current && current.simulateOneFailure);
    }

    const config = await SystemConfig.findOneAndUpdate(
      { key: 'DEFAULT_CONFIG' },
      { $set: { simulateOneFailure: targetState } },
      { upsert: true, new: true }
    );

    return res.json({
      message: `Worker fault simulation ${targetState ? 'ENABLED' : 'DISABLED'}`,
      simulateOneFailure: config.simulateOneFailure,
    });
  } catch (error) {
    console.error('toggleFaultSimulation error:', error);
    return res.status(500).json({ error: 'Failed to toggle fault simulation' });
  }
};

/**
 * Get Dead-Letter Queue failed jobs (BullMQ failed set)
 */
const getDLQ = async (req, res) => {
  try {
    const { start = 0, end = 50 } = req.query;
    const dlqJobs = await getDeadLetterQueue(Number(start), Number(end));
    return res.json({
      count: dlqJobs.length,
      jobs: dlqJobs,
    });
  } catch (error) {
    console.error('getDLQ error:', error);
    return res.status(500).json({ error: 'Failed to fetch Dead-Letter Queue' });
  }
};

/**
 * Replay a failed payment (Admin action)
 */
const replayPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId is required' });
    }

    const { payment, job } = await replayPaymentJob(paymentId);

    return res.json({
      message: 'Payment successfully re-queued for processing',
      paymentId: payment._id,
      jobId: job.id,
      status: payment.status,
    });
  } catch (error) {
    console.error('replayPayment error:', error);
    return res.status(400).json({ error: error.message || 'Failed to replay payment' });
  }
};

module.exports = {
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
};
