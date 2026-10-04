const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const { getRedisConfig, createRedisConnection, publishEvent } = require('../config/redis');
const { QUEUE_NAME, reconcileOrphanedPayments } = require('../queue/paymentQueue');
const Payment = require('../models/Payment');
const PaymentJob = require('../models/PaymentJob');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog');
const WorkerHeartbeat = require('../models/WorkerHeartbeat');
const SystemConfig = require('../models/SystemConfig');
const {
  InsufficientBalanceError,
  ValidationError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  SimulatedFailureError,
  isTerminalFailure,
} = require('../utils/errors');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

class PaymentWorker {
  constructor(workerId) {
    this.workerId = workerId || process.env.WORKER_ID || `worker-node-${process.pid}`;
    this.processId = process.pid;
    this.isRunning = false;
    this.concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;
    this.heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_INTERVAL) || 2000;
    this.reconcileIntervalMs = Number(process.env.RECONCILE_INTERVAL_MS) || 30000;
    this.heartbeatTimer = null;
    this.reconcileTimer = null;
    this.startedAt = new Date();
    this.bullWorker = null;
  }

  async getConfig() {
    try {
      let config = await SystemConfig.findOne({ key: 'DEFAULT_CONFIG' });
      if (!config) {
        const envDelay = Number(process.env.DEMO_PROCESSING_DELAY_MS);
        config = await SystemConfig.create({
          key: 'DEFAULT_CONFIG',
          demoDelayMs: !isNaN(envDelay) ? envDelay : 5000,
          simulateOneFailure: process.env.SIMULATE_ONE_FAILURE === 'true',
        });
      }
      return config;
    } catch (err) {
      return {
        demoDelayMs: Number(process.env.DEMO_PROCESSING_DELAY_MS) || 5000,
        simulateOneFailure: process.env.SIMULATE_ONE_FAILURE === 'true',
      };
    }
  }

  async sendHeartbeat(statusOverride = null, jobId = null, paymentId = null, attempt = 0) {
    try {
      const status = statusOverride || (jobId ? 'PROCESSING' : 'ONLINE');
      await WorkerHeartbeat.findOneAndUpdate(
        { workerId: this.workerId },
        {
          $set: {
            processId: this.processId,
            status,
            lastHeartbeat: new Date(),
            currentJobId: jobId ? String(jobId) : null,
            currentPaymentId: paymentId ? String(paymentId) : null,
            currentAttempt: attempt,
            startedAt: this.startedAt,
            stoppedAt: null,
          },
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      // Non-blocking heartbeat save
    }
  }

  // The worker is a separate process, so realtime events go through Redis pub/sub;
  // the API server subscribes and forwards them to the right Socket.IO rooms.
  emitSocket(event, payload) {
    return publishEvent(event, payload);
  }

  async start() {
    this.isRunning = true;
    console.log(`[Worker ${this.workerId}] Process started (PID ${this.processId}). Concurrency: ${this.concurrency}`);
    console.log(`[Worker ${this.workerId}] Queue Engine: Redis + BullMQ (${QUEUE_NAME})`);

    await this.sendHeartbeat('ONLINE');
    console.log(`[Worker ${this.workerId}] Heartbeat started (interval: ${this.heartbeatIntervalMs}ms)`);

    this.heartbeatTimer = setInterval(async () => {
      if (this.isRunning && !this.busyJobs) {
        await this.sendHeartbeat();
      }
    }, this.heartbeatIntervalMs);

    // Recovery sweep for payments that never got a BullMQ job
    const sweep = () =>
      reconcileOrphanedPayments().catch((err) =>
        console.error(`[Worker ${this.workerId}] Reconciler error:`, err.message)
      );
    sweep();
    this.reconcileTimer = setInterval(sweep, this.reconcileIntervalMs);

    const shutdown = async (signal) => {
      console.log(`[Worker ${this.workerId}] Received ${signal}. Closing BullMQ worker and marking OFFLINE...`);
      await this.stop();
      try {
        await WorkerHeartbeat.findOneAndUpdate(
          { workerId: this.workerId },
          {
            $set: {
              status: 'OFFLINE',
              lastHeartbeat: new Date(),
              stoppedAt: new Date(),
              currentJobId: null,
              currentPaymentId: null,
              currentAttempt: 0,
            },
          }
        );
      } catch (err) {
        console.error('Error during graceful shutdown:', err.message);
      }
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    const redisConfig = getRedisConfig();
    this.bullWorker = new Worker(QUEUE_NAME, async (job) => this.handleJob(job), {
      connection: typeof redisConfig === 'string' ? createRedisConnection() : redisConfig,
      concurrency: this.concurrency,
      limiter: { max: 100, duration: 1000 },
    });

    this.bullWorker.on('completed', async (job) => {
      console.log(`[Worker ${this.workerId}] Job ${job.id} (Payment ${job.data.paymentId}) COMPLETED successfully.`);
      await this.sendHeartbeat('ONLINE', null, null, 0);
    });

    this.bullWorker.on('failed', (job, err) => this.handleFailedJob(job, err));

    this.bullWorker.on('error', (err) => {
      console.error(`[Worker ${this.workerId}] BullMQ Worker error:`, err.message);
    });

    console.log(`[Worker ${this.workerId}] Ready and actively listening for BullMQ jobs...`);
  }

  /**
   * Runs after every failed attempt. BullMQ has already decided whether the job is retried
   * (state "delayed") or permanently failed; this mirrors that decision into MongoDB.
   */
  async handleFailedJob(job, err) {
    const attempts = job?.attemptsMade || 0;
    const maxAttempts = job?.opts?.attempts || 3;
    const paymentId = job?.data?.paymentId;

    console.error(
      `[Worker ${this.workerId}] Job ${job?.id} (Payment ${paymentId}) failed on attempt ${attempts}/${maxAttempts}: ${err.message}`
    );

    await this.sendHeartbeat('ONLINE', null, null, 0);
    if (!paymentId) return;

    try {
      if (isTerminalFailure(err, job)) {
        const permanent = !(attempts >= maxAttempts) || err.code === 'INSUFFICIENT_BALANCE';
        const failureReason = permanent
          ? err.message
          : `Exhausted ${attempts}/${maxAttempts} attempts. Error: ${err.message}`;

        await Payment.findByIdAndUpdate(paymentId, {
          $set: { status: 'FAILED', attempts, failureReason },
        });

        await PaymentJob.findOneAndUpdate(
          { paymentId },
          { $set: { status: 'FAILED', attempts, lastError: err.message, lockedAt: null, lockedBy: null } }
        );

        await AuditLog.create({
          actorRole: 'WORKER',
          action: 'FAILED',
          entityType: 'Payment',
          entityId: paymentId,
          metadata: {
            paymentId,
            jobId: job.id,
            workerId: this.workerId,
            attempts,
            maxAttempts,
            failureReason: err.message,
            errorCode: err.code || null,
            deadLetter: true,
            message: permanent
              ? `Payment permanently FAILED (non-retryable: ${err.message})`
              : `Payment permanently FAILED after ${attempts} attempts (Sent to Dead-Letter Queue)`,
          },
        });

        await this.emitSocket('payment_status', { paymentId, status: 'FAILED', failureReason: err.message, attempts });
      } else {
        // BullMQ exponential backoff: base * 2^(attemptsMade - 1)
        const base = job?.opts?.backoff?.delay || Number(process.env.RETRY_BACKOFF_DELAY_MS) || 2000;
        const delayMs = base * Math.pow(2, Math.max(attempts - 1, 0));
        const nextAvailableAt = new Date(Date.now() + delayMs);

        await Payment.findByIdAndUpdate(paymentId, {
          $set: {
            status: 'QUEUED',
            attempts,
            failureReason: `Attempt ${attempts} failed: ${err.message}. Retrying via BullMQ exponential backoff`,
          },
        });

        await PaymentJob.findOneAndUpdate(
          { paymentId },
          {
            $set: {
              status: 'QUEUED',
              attempts,
              lastError: err.message,
              availableAt: nextAvailableAt,
              lockedAt: null,
              lockedBy: null,
            },
          }
        );

        await AuditLog.create({
          actorRole: 'WORKER',
          action: 'RETRY_SCHEDULED',
          entityType: 'PaymentJob',
          entityId: String(job.id),
          metadata: {
            paymentId,
            jobId: job.id,
            workerId: this.workerId,
            attempt: attempts,
            maxAttempts,
            error: err.message,
            nextAvailableAt,
            message: `BullMQ scheduled retry #${attempts + 1} with exponential backoff`,
          },
        });

        await this.emitSocket('payment_status', {
          paymentId,
          status: 'RETRY_SCHEDULED',
          attempt: attempts,
          nextAttempt: attempts + 1,
        });
      }
    } catch (dbErr) {
      console.error(`[Worker ${this.workerId}] Failed to record job failure for ${paymentId}:`, dbErr.message);
    }
  }

  async handleJob(job) {
    const paymentId = job.data?.paymentId;
    if (!paymentId) {
      throw new ValidationError('Job payload missing paymentId');
    }

    const currentAttempt = (job.attemptsMade || 0) + 1;
    this.busyJobs = (this.busyJobs || 0) + 1;

    try {
      return await this.processPayment(job, paymentId, currentAttempt);
    } finally {
      this.busyJobs -= 1;
    }
  }

  async processPayment(job, paymentId, currentAttempt) {
    await this.sendHeartbeat('PROCESSING', job.id, paymentId, currentAttempt);
    const config = await this.getConfig();

    console.log(`[Worker ${this.workerId}] Claimed BullMQ Job ${job.id}`);
    console.log(`[Worker ${this.workerId}] Processing payment ${paymentId} (attempt ${currentAttempt})`);

    await AuditLog.create({
      actorRole: 'WORKER',
      action: 'WORKER_CLAIMED',
      entityType: 'PaymentJob',
      entityId: String(job.id),
      metadata: {
        paymentId,
        jobId: job.id,
        workerId: this.workerId,
        attempt: currentAttempt,
        message: `Worker ${this.workerId} claimed BullMQ job ${job.id}`,
      },
    });

    // Don't resurrect a payment that is already finished (duplicate delivery)
    const current = await Payment.findById(paymentId).select('status');
    if (!current) {
      throw new PaymentNotFoundError(`Payment record ${paymentId} missing`);
    }
    if (current.status !== 'SUCCESS') {
      await Payment.findByIdAndUpdate(paymentId, { $set: { status: 'PROCESSING', attempts: currentAttempt } });
    }

    await PaymentJob.findOneAndUpdate(
      { paymentId },
      { $set: { status: 'PROCESSING', attempts: currentAttempt, lockedAt: new Date(), lockedBy: this.workerId } }
    );

    await AuditLog.create({
      actorRole: 'WORKER',
      action: 'PROCESSING',
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        paymentId,
        jobId: job.id,
        workerId: this.workerId,
        attempt: currentAttempt,
        message: `Worker is processing payment transaction (Attempt #${currentAttempt})`,
      },
    });

    await this.emitSocket('payment_status', {
      paymentId,
      status: 'PROCESSING',
      workerId: this.workerId,
      attempt: currentAttempt,
    });

    // Demo-only delay so the trace timeline is visible
    const demoDelayMs = config.demoDelayMs ?? 5000;
    if (demoDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, demoDelayMs));
    }

    // Controlled single-failure simulation (admin toggle). Atomically consume the flag so only
    // ONE job is failed even with concurrency > 1.
    if (config.simulateOneFailure && currentAttempt === 1) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateOneFailure: true },
        { $set: { simulateOneFailure: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] Controlled failure simulation triggered before transaction commit`);
        await AuditLog.create({
          actorRole: 'WORKER',
          action: 'WORKER_FAILURE',
          entityType: 'PaymentJob',
          entityId: String(job.id),
          metadata: {
            paymentId,
            jobId: job.id,
            workerId: this.workerId,
            attempt: currentAttempt,
            error: 'Controlled worker failure simulation triggered before transaction commit',
            message: `Worker encountered simulated fault on attempt ${currentAttempt}`,
          },
        });
        throw new SimulatedFailureError('Controlled worker failure simulation triggered before transaction commit');
      }
    }

    console.log(`[Worker ${this.workerId}] Atomic transaction started`);
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) {
        throw new PaymentNotFoundError(`Payment record ${paymentId} missing`);
      }

      // Idempotency inside the transaction: already completed -> no second debit
      if (payment.status === 'SUCCESS') {
        await PaymentJob.findOneAndUpdate(
          { paymentId },
          { $set: { status: 'SUCCESS', lockedAt: null, lockedBy: null, completedAt: new Date() } },
          { session }
        );
        await session.commitTransaction();
        console.log(`[Worker ${this.workerId}] Payment was already completed (duplicate delivery ignored)`);
        return { status: 'SUCCESS', isDuplicate: true };
      }

      const senderWallet = await Wallet.findOne({ userId: payment.senderId }).session(session);
      const recipientWallet = await Wallet.findOne({ userId: payment.recipientId }).session(session);
      if (!senderWallet) throw new RecipientNotFoundError('Sender wallet not found');
      if (!recipientWallet) throw new RecipientNotFoundError('Recipient wallet not found');

      const amount = round2(payment.amount);

      // Conditional atomic debit: succeeds only if balance >= amount (no read-modify-write race)
      const debited = await Wallet.findOneAndUpdate(
        { _id: senderWallet._id, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { session, new: true }
      );
      if (!debited) {
        // Non-retryable; the transaction is aborted in the catch block and the
        // 'failed' handler records FAILED + audit log exactly once.
        throw new InsufficientBalanceError(`Insufficient wallet balance ($${senderWallet.balance.toFixed(2)})`);
      }

      await Wallet.findOneAndUpdate({ _id: recipientWallet._id }, { $inc: { balance: amount } }, { session });

      const timestamp = Date.now();
      const debitRef = `DEB-${payment._id}-${timestamp}`;
      const creditRef = `CRE-${payment._id}-${timestamp}`;

      await Transaction.create(
        [
          {
            paymentId: payment._id,
            senderId: payment.senderId,
            recipientId: payment.recipientId,
            amount,
            type: 'DEBIT',
            status: 'SUCCESS',
            reference: debitRef,
          },
          {
            paymentId: payment._id,
            senderId: payment.senderId,
            recipientId: payment.recipientId,
            amount,
            type: 'CREDIT',
            status: 'SUCCESS',
            reference: creditRef,
          },
        ],
        { session, ordered: true }
      );

      payment.status = 'SUCCESS';
      payment.completedAt = new Date();
      payment.attempts = currentAttempt;
      payment.failureReason = null;
      await payment.save({ session });

      await PaymentJob.findOneAndUpdate(
        { paymentId: payment._id },
        { $set: { status: 'SUCCESS', lockedAt: null, lockedBy: null, completedAt: new Date() } },
        { session }
      );

      await session.commitTransaction();
      console.log(`[Worker ${this.workerId}] Atomic transaction committed`);

      // Post-commit bookkeeping must never fail the job (the money has already moved)
      try {
        await AuditLog.create({
          actorRole: 'WORKER',
          action: 'SUCCESS',
          entityType: 'Payment',
          entityId: payment._id.toString(),
          metadata: {
            paymentId: payment._id.toString(),
            jobId: job.id,
            workerId: this.workerId,
            attempt: currentAttempt,
            amount,
            debitRef,
            creditRef,
            message: 'Atomic MongoDB transaction committed successfully',
          },
        });
        await this.emitSocket('payment_status', {
          paymentId: payment._id.toString(),
          status: 'SUCCESS',
          amount,
          senderId: payment.senderId.toString(),
          recipientId: payment.recipientId.toString(),
        });
      } catch (postErr) {
        console.error(`[Worker ${this.workerId}] Post-commit bookkeeping failed:`, postErr.message);
      }

      console.log(`[Worker ${this.workerId}] Payment SUCCESS`);
      return { status: 'SUCCESS', paymentId: payment._id.toString() };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      // E11000 on Transaction(paymentId,type): a previous attempt already committed
      const isDuplicateError = error.code === 11000 || (error.message && error.message.includes('E11000'));
      if (isDuplicateError) {
        const existingTx = await Transaction.find({ paymentId });
        if (existingTx.length > 0) {
          console.log(`[Worker ${this.workerId}] Duplicate execution detected for ${paymentId}. Preserving SUCCESS state.`);
          await Payment.findByIdAndUpdate(paymentId, { $set: { status: 'SUCCESS', failureReason: null } });
          await PaymentJob.findOneAndUpdate(
            { paymentId },
            { $set: { status: 'SUCCESS', lockedAt: null, lockedBy: null, completedAt: new Date() } }
          );
          return { status: 'SUCCESS', duplicateDetected: true };
        }
      }

      console.error(`[Worker ${this.workerId}] Error processing job ${job.id}:`, error.message);
      throw error; // BullMQ decides retry vs. permanent failure
    } finally {
      session.endSession();
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    console.log(`[Worker ${this.workerId}] Worker process stopped.`);
  }
}

module.exports = PaymentWorker;
