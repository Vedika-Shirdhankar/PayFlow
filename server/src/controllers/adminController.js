const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Payment = require('../models/Payment');
const PaymentJob = require('../models/PaymentJob');
const AuditLog = require('../models/AuditLog');
const SystemConfig = require('../models/SystemConfig');
const WorkerHeartbeat = require('../models/WorkerHeartbeat');
const { getQueueStats, getDeadLetterQueue, replayPaymentJob } = require('../queue/paymentQueue');
const { getDatabaseHealth } = require('../config/db');
const { paymentWorkerCircuit, databaseCircuit } = require('../utils/circuitBreaker');

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
        stats: w.stats || null,
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
      simulateNetworkError: config.simulateNetworkError,
      simulateDbError: config.simulateDbError,
      simulateTimeout: config.simulateTimeout,
      simulateServerError: config.simulateServerError,
      simulateWorkerCrash: config.simulateWorkerCrash,
      simulateOutage: config.simulateOutage,
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
    const {
      demoDelayMs,
      simulateOneFailure,
      simulateNetworkError,
      simulateDbError,
      simulateTimeout,
      simulateServerError,
      simulateWorkerCrash,
      simulateOutage,
    } = req.body;
    const updateData = {};

    if (demoDelayMs !== undefined) {
      const delay = Number(demoDelayMs);
      if (!Number.isFinite(delay) || delay < 0 || delay > 60000) {
        return res.status(400).json({ error: 'demoDelayMs must be a number between 0 and 60000' });
      }
      updateData.demoDelayMs = delay;
    }
    if (simulateOneFailure !== undefined) updateData.simulateOneFailure = Boolean(simulateOneFailure);
    if (simulateNetworkError !== undefined) updateData.simulateNetworkError = Boolean(simulateNetworkError);
    if (simulateDbError !== undefined) updateData.simulateDbError = Boolean(simulateDbError);
    if (simulateTimeout !== undefined) updateData.simulateTimeout = Boolean(simulateTimeout);
    if (simulateServerError !== undefined) updateData.simulateServerError = Boolean(simulateServerError);
    if (simulateWorkerCrash !== undefined) updateData.simulateWorkerCrash = Boolean(simulateWorkerCrash);
    if (simulateOutage !== undefined) updateData.simulateOutage = Boolean(simulateOutage);

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
        changes: updateData,
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
 * Trigger a specific failure simulation type.
 */
const triggerSimulation = async (req, res) => {
  try {
    const { type } = req.body;
    const simulationMap = {
      worker_fault: 'simulateOneFailure',
      network_error: 'simulateNetworkError',
      database_error: 'simulateDbError',
      timeout: 'simulateTimeout',
      server_error: 'simulateServerError',
      worker_crash: 'simulateWorkerCrash',
      outage: 'simulateOutage',
    };

    if (!type || !simulationMap[type]) {
      return res.status(400).json({
        error: `Invalid simulation type. Valid types: ${Object.keys(simulationMap).join(', ')}`,
      });
    }

    const field = simulationMap[type];
    const config = await SystemConfig.findOneAndUpdate(
      { key: 'DEFAULT_CONFIG' },
      { $set: { [field]: true } },
      { upsert: true, new: true }
    );

    await AuditLog.create({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'SYSTEM_CONFIG_UPDATE',
      entityType: 'SystemConfig',
      metadata: {
        updatedBy: req.user.email,
        simulationType: type,
        field,
        message: `Admin triggered simulation: ${type}`,
        isSimulated: true,
      },
    });

    const descriptions = {
      worker_fault: 'Worker fault simulation armed — next job attempt #1 will simulate a worker exception',
      network_error: 'Network error simulation armed — next job will simulate a network connection failure',
      database_error: 'Database failure simulation armed — next job will simulate MongoDB unavailability',
      timeout: 'Timeout simulation armed — next job will simulate a processing timeout with post-timeout idempotency check',
      server_error: 'Server error simulation armed — next job will simulate an HTTP 500 API service failure',
      worker_crash: 'Worker crash simulation armed — next job attempt #1 will simulate a worker process crash',
      outage: 'Infrastructure outage simulation armed — next job will simulate a complete system outage',
    };

    return res.json({
      message: descriptions[type],
      simulationType: type,
      field,
      config: {
        simulateOneFailure: config.simulateOneFailure,
        simulateNetworkError: config.simulateNetworkError,
        simulateDbError: config.simulateDbError,
        simulateTimeout: config.simulateTimeout,
        simulateServerError: config.simulateServerError,
        simulateWorkerCrash: config.simulateWorkerCrash,
        simulateOutage: config.simulateOutage,
      },
    });
  } catch (error) {
    console.error('triggerSimulation error:', error);
    return res.status(500).json({ error: 'Failed to trigger simulation' });
  }
};

/**
 * Clear all active simulation flags.
 */
const clearAllSimulations = async (req, res) => {
  try {
    const config = await SystemConfig.findOneAndUpdate(
      { key: 'DEFAULT_CONFIG' },
      {
        $set: {
          simulateOneFailure: false,
          simulateNetworkError: false,
          simulateDbError: false,
          simulateTimeout: false,
          simulateServerError: false,
          simulateWorkerCrash: false,
          simulateOutage: false,
        },
      },
      { upsert: true, new: true }
    );

    return res.json({
      message: 'All simulation flags cleared',
      config,
    });
  } catch (error) {
    console.error('clearAllSimulations error:', error);
    return res.status(500).json({ error: 'Failed to clear simulations' });
  }
};

/**
 * Get MongoDB database health metrics.
 */
const getDatabaseHealthEndpoint = async (req, res) => {
  try {
    const health = await getDatabaseHealth();
    return res.json(health);
  } catch (error) {
    console.error('getDatabaseHealth error:', error);
    return res.status(500).json({ error: 'Failed to fetch database health', details: error.message });
  }
};

/**
 * Get circuit breaker state for all registered breakers.
 */
const getCircuitBreakerStatus = async (req, res) => {
  try {
    return res.json({
      circuitBreakers: [
        paymentWorkerCircuit.getState(),
        databaseCircuit.getState(),
      ],
    });
  } catch (error) {
    console.error('getCircuitBreakerStatus error:', error);
    return res.status(500).json({ error: 'Failed to fetch circuit breaker status' });
  }
};

/**
 * Manually reset a circuit breaker.
 */
const resetCircuitBreaker = async (req, res) => {
  try {
    const { name } = req.body;

    const breakers = {
      PaymentWorkerCircuit: paymentWorkerCircuit,
      DatabaseCircuit: databaseCircuit,
    };

    if (!name || !breakers[name]) {
      return res.status(400).json({
        error: `Invalid circuit breaker name. Valid names: ${Object.keys(breakers).join(', ')}`,
      });
    }

    breakers[name].reset();

    await AuditLog.create({
      actorId: req.user.userId,
      actorRole: req.user.role,
      action: 'SYSTEM_CONFIG_UPDATE',
      entityType: 'CircuitBreaker',
      metadata: {
        updatedBy: req.user.email,
        circuitBreakerName: name,
        message: `Admin manually reset circuit breaker: ${name}`,
      },
    });

    return res.json({
      message: `Circuit breaker '${name}' reset to CLOSED state`,
      state: breakers[name].getState(),
    });
  } catch (error) {
    console.error('resetCircuitBreaker error:', error);
    return res.status(500).json({ error: 'Failed to reset circuit breaker' });
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

/**
 * Live System Topology Map snapshot endpoint.
 * Returns health, node states, and fault simulation statuses for visual graph rendering.
 */
const getSystemTopology = async (req, res) => {
  try {
    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const cutoff = new Date(Date.now() - timeoutMs);

    const [
      dbHealth,
      queueStats,
      allWorkers,
      systemConfig,
    ] = await Promise.all([
      getDatabaseHealth(),
      getQueueStats(),
      WorkerHeartbeat.find().sort({ lastHeartbeat: -1 }),
      SystemConfig.findOne({ key: 'DEFAULT_CONFIG' }),
    ]);

    const onlineWorkers = allWorkers.filter(
      (w) => w.status !== 'OFFLINE' && new Date(w.lastHeartbeat) >= cutoff
    );

    const config = systemConfig || {};

    // 1. API Node Status
    const apiStatus = config.simulateOutage || config.simulateServerError ? 'UNHEALTHY' : 'HEALTHY';

    // 2. Queue Node Status
    const queueStatus = config.simulateOutage ? 'UNHEALTHY' : (queueStats.waiting > 20 ? 'DEGRADED' : 'HEALTHY');

    // 3. Worker Node Status
    const workerStatus = config.simulateOutage || config.simulateWorkerCrash || onlineWorkers.length === 0 ? 'UNHEALTHY' : 'HEALTHY';

    // 4. Database Primary Node Status
    const dbPrimaryStatus = config.simulateOutage || config.simulateNetworkError || config.simulateDbError || !dbHealth.connected ? 'UNHEALTHY' : 'HEALTHY';

    // 5. Database Secondaries Node Status
    const dbSecondaryStatus = config.simulateOutage || config.simulateNetworkError || !dbHealth.connected ? 'UNHEALTHY' : 'HEALTHY';

    // 6. Socket / Monitoring Node Status
    const socketStatus = config.simulateOutage ? 'UNHEALTHY' : 'HEALTHY';

    const nodes = {
      api: {
        id: 'api-producer',
        label: 'Express API Producer',
        type: 'PRODUCER',
        status: apiStatus,
        details: {
          port: process.env.PORT || 5000,
          protocol: 'HTTP / JSON',
          responseType: 'HTTP 202 Accepted',
          faultSimulated: Boolean(config.simulateServerError || config.simulateOutage),
        },
      },
      queue: {
        id: 'redis-bullmq',
        label: 'BullMQ & Redis Queue',
        type: 'QUEUE',
        status: queueStatus,
        details: {
          queueName: 'payment-processing',
          waiting: queueStats.waiting,
          active: queueStats.active,
          delayed: queueStats.delayed,
          failed: queueStats.failed,
          completed: queueStats.completed,
          faultSimulated: Boolean(config.simulateOutage),
        },
      },
      worker: {
        id: 'node-worker',
        label: 'Node.js Consumer Workers',
        type: 'CONSUMER',
        status: workerStatus,
        details: {
          totalRegistered: allWorkers.length,
          activeWorkers: onlineWorkers.length,
          concurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
          activeProcessId: onlineWorkers[0] ? onlineWorkers[0].processId : null,
          faultSimulated: Boolean(config.simulateWorkerCrash || config.simulateOutage),
        },
      },
      dbPrimary: {
        id: 'mongo-primary',
        label: 'MongoDB Primary (Writable)',
        type: 'DATABASE_PRIMARY',
        status: dbPrimaryStatus,
        details: {
          topology: dbHealth.topology || 'replicaSet',
          replicaSet: dbHealth.replicaSet || 'atlas-shard-0',
          responseTimeMs: dbHealth.responseTimeMs,
          connected: dbHealth.connected,
          faultSimulated: Boolean(config.simulateNetworkError || config.simulateDbError || config.simulateOutage),
        },
      },
      dbSecondary: {
        id: 'mongo-secondaries',
        label: 'MongoDB Secondaries (Replicas)',
        type: 'DATABASE_SECONDARY',
        status: dbSecondaryStatus,
        details: {
          count: dbHealth.hosts ? Math.max(dbHealth.hosts.length - 1, 2) : 2,
          replicationLagSec: dbHealth.replicationLag ?? 0,
          replicationStatus: dbHealth.replicationStatus || 'healthy',
          faultSimulated: Boolean(config.simulateNetworkError || config.simulateOutage),
        },
      },
      monitor: {
        id: 'realtime-monitor',
        label: 'Realtime Socket.IO & Pub/Sub',
        type: 'MONITOR',
        status: socketStatus,
        details: {
          channel: 'payflow:events',
          protocol: 'WebSocket / Engine.IO',
          faultSimulated: Boolean(config.simulateOutage),
        },
      },
    };

    return res.json({
      timestamp: new Date(),
      nodes,
      simulations: {
        simulateNetworkError: Boolean(config.simulateNetworkError),
        simulateDbError: Boolean(config.simulateDbError),
        simulateWorkerCrash: Boolean(config.simulateWorkerCrash),
        simulateServerError: Boolean(config.simulateServerError),
        simulateTimeout: Boolean(config.simulateTimeout),
        simulateOutage: Boolean(config.simulateOutage),
        simulateOneFailure: Boolean(config.simulateOneFailure),
      },
      circuitBreaker: {
        paymentWorkerCircuit: paymentWorkerCircuit.getState(),
        databaseCircuit: databaseCircuit.getState(),
      },
    });
  } catch (error) {
    console.error('getSystemTopology error:', error);
    return res.status(500).json({ error: 'Failed to fetch system topology' });
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
  triggerSimulation,
  clearAllSimulations,
  getDatabaseHealthEndpoint,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  getDLQ,
  replayPayment,
  getSystemTopology,
};
