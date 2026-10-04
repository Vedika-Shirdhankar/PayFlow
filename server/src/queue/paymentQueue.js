const { Queue, QueueEvents } = require('bullmq');
const { getRedisConfig, createRedisConnection } = require('../config/redis');
const PaymentJob = require('../models/PaymentJob');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');

const QUEUE_NAME = 'payment-processing';

const redisConfig = getRedisConfig();

// Initialize BullMQ Queue
const paymentQueue = new Queue(QUEUE_NAME, {
  connection: typeof redisConfig === 'string' ? createRedisConnection() : redisConfig,
  defaultJobOptions: {
    attempts: Number(process.env.MAX_JOB_ATTEMPTS) || 3,
    backoff: {
      type: 'exponential',
      delay: Number(process.env.RETRY_BACKOFF_DELAY_MS) || 2000,
    },
    removeOnComplete: {
      count: 500, // Keep last 500 completed jobs
    },
    removeOnFail: false, // Keep failed jobs for DLQ / replay inspection
  },
});

/**
 * Adds a payment processing job to BullMQ and records history in PaymentJob
 * @param {string|mongoose.Types.ObjectId} paymentId
 * @param {object} customOpts
 */
const addPaymentJob = async (paymentId, customOpts = {}) => {
  const pidString = paymentId.toString();

  const maxAttempts = customOpts.attempts || Number(process.env.MAX_JOB_ATTEMPTS) || 3;
  const backoffDelay = customOpts.backoffDelay || Number(process.env.RETRY_BACKOFF_DELAY_MS) || 2000;
  const { backoffDelay: _ignored, ...restOpts } = customOpts;

  // Record the PaymentJob in MongoDB FIRST so an audit trail exists even if Redis is down.
  const paymentJob = await PaymentJob.findOneAndUpdate(
    { paymentId },
    {
      $set: {
        status: 'QUEUED',
        attempts: 0,
        maxAttempts,
        availableAt: new Date(),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    },
    { upsert: true, new: true }
  );

  // jobId = paymentId makes enqueueing idempotent: the same payment can never be queued twice.
  const job = await paymentQueue.add(
    'process-payment',
    { paymentId: pidString },
    {
      attempts: maxAttempts,
      backoff: { type: 'exponential', delay: backoffDelay },
      ...restOpts,
      jobId: pidString,
    }
  );

  return { job, paymentJob };
};

/**
 * Recovery sweep for the Mongo <-> Redis write gap: payments stuck in QUEUED with no live
 * BullMQ job (e.g. the API crashed between Payment.create and queue.add, or Redis was flushed).
 */
const reconcileOrphanedPayments = async ({ olderThanMs = 30000 } = {}) => {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await Payment.find({ status: 'QUEUED', updatedAt: { $lt: cutoff } }).limit(100);
  let recovered = 0;

  for (const payment of stale) {
    const pid = payment._id.toString();
    const existing = await paymentQueue.getJob(pid);
    const state = existing ? await existing.getState() : null;

    // Healthy job (waiting / delayed / active / ...) -> leave it alone
    if (state && !['failed', 'completed', 'unknown'].includes(state)) continue;

    if (existing) {
      try {
        await existing.remove();
      } catch (err) {
        continue;
      }
    }

    await addPaymentJob(payment._id);
    await AuditLog.create({
      actorRole: 'SYSTEM',
      action: 'WORKER_RECOVERY',
      entityType: 'Payment',
      entityId: pid,
      metadata: {
        paymentId: pid,
        message: 'Reconciler re-enqueued an orphaned QUEUED payment that had no live job.',
      },
    });
    recovered++;
  }

  if (recovered > 0) {
    console.log(`[Reconciler] Re-enqueued ${recovered} orphaned payment(s).`);
  }
  return recovered;
};

/**
 * Get real-time queue metrics directly from Redis via BullMQ
 */
const getQueueStats = async () => {
  try {
    const counts = await paymentQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: counts.paused || 0,
      total:
        (counts.waiting || 0) +
        (counts.active || 0) +
        (counts.completed || 0) +
        (counts.failed || 0) +
        (counts.delayed || 0),
    };
  } catch (error) {
    console.error('Error fetching BullMQ queue stats:', error.message);
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
      total: 0,
      error: error.message,
    };
  }
};

/**
 * Retrieve failed jobs (Dead-Letter Queue inspection)
 */
const getDeadLetterQueue = async (start = 0, end = 50) => {
  try {
    const failedJobs = await paymentQueue.getFailed(start, end);
    const results = [];

    for (const job of failedJobs) {
      const paymentId = job.data?.paymentId;
      let paymentRecord = null;
      if (paymentId) {
        paymentRecord = await Payment.findById(paymentId)
          .populate('senderId', 'name email')
          .populate('recipientId', 'name email');
      }

      results.push({
        jobId: job.id,
        name: job.name,
        paymentId: job.data?.paymentId,
        payment: paymentRecord,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts || 3,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        failedTimestamp: job.finishedOn,
        processedOn: job.processedOn,
        timestamp: job.timestamp,
      });
    }

    return results;
  } catch (error) {
    console.error('Error retrieving DLQ jobs from BullMQ:', error.message);
    return [];
  }
};

/**
 * Replay a failed job / payment (Admin operation)
 */
const replayPaymentJob = async (paymentId) => {
  const pidString = paymentId.toString();

  const payment = await Payment.findById(pidString);
  if (!payment) {
    throw new Error('Payment not found');
  }

  if (payment.status !== 'FAILED') {
    throw new Error(`Cannot replay payment in state '${payment.status}'. Only FAILED payments can be replayed.`);
  }

  // Remove the old failed BullMQ job (same jobId would otherwise be ignored as a duplicate)
  const oldJob = await paymentQueue.getJob(pidString);
  if (oldJob) {
    try {
      await oldJob.remove();
    } catch (err) {
      throw new Error(`Could not remove previous job: ${err.message}`);
    }
  }

  // Reset payment in MongoDB
  payment.status = 'QUEUED';
  payment.failureReason = null;
  payment.attempts = 0;
  await payment.save();

  // Add a fresh BullMQ job (also resets PaymentJob in MongoDB)
  const { job } = await addPaymentJob(payment._id);

  await AuditLog.create({
    actorRole: 'ADMIN',
    action: 'PAYMENT_REPLAYED',
    entityType: 'Payment',
    entityId: payment._id.toString(),
    metadata: {
      paymentId: payment._id.toString(),
      jobId: job.id,
      replayed: true,
      message: 'Admin initiated payment replay. Job requeued to BullMQ.',
    },
  });

  return { payment, job };
};

module.exports = {
  paymentQueue,
  QUEUE_NAME,
  addPaymentJob,
  reconcileOrphanedPayments,
  getQueueStats,
  getDeadLetterQueue,
  replayPaymentJob,
};
