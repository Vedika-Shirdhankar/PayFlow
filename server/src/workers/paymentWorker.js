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
const { paymentWorkerCircuit } = require('../utils/circuitBreaker');
const { generateCorrelationId } = require('../middleware/tracing');
const {
  InsufficientBalanceError,
  ValidationError,
  PaymentNotFoundError,
  RecipientNotFoundError,
  SimulatedFailureError,
  DatabaseTransientError,
  NetworkTransientError,
  TimeoutTransientError,
  InfrastructureOutageError,
  ServerTransientError,
  classifyError,
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
    this.reconcileIntervalMs = Number(process.env.RECONCILE_INTERVAL_MS) || 10000;
    this.heartbeatTimer = null;
    this.reconcileTimer = null;
    this.startedAt = new Date();
    this.bullWorker = null;
    this.busyJobs = 0;
    this.stats = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    this.pendingOfflineEvents = [];
  }

  async flushOfflineEvents() {
    if (!this.pendingOfflineEvents || this.pendingOfflineEvents.length === 0) return;
    const items = [...this.pendingOfflineEvents];
    this.pendingOfflineEvents = [];

    for (const item of items) {
      try {
        await AuditLog.create({
          correlationId: item.correlationId,
          actorRole: 'WORKER',
          action: item.action,
          entityType: 'PaymentJob',
          entityId: String(item.jobId),
          metadata: item.metadata,
        });

        if (item.action === 'FAILED') {
          await Payment.findByIdAndUpdate(item.paymentId, {
            $set: {
              status: 'FAILED',
              attempts: item.attempts,
              failureReason: item.metadata?.failureReason || item.metadata?.error,
              errorCode: item.metadata?.errorCode,
              errorCategory: item.metadata?.errorCategory,
            },
          });
          await PaymentJob.findOneAndUpdate(
            { paymentId: item.paymentId },
            { $set: { status: 'FAILED', attempts: item.attempts, lastError: item.metadata?.error } }
          );
        }
      } catch (_) {
        this.pendingOfflineEvents.push(item);
      }
    }
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
        simulateNetworkError: false,
        simulateDbError: false,
        simulateTimeout: false,
        simulateServerError: false,
        simulateWorkerCrash: false,
        simulateOutage: false,
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
            stats: this.stats,
          },
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      // Non-blocking heartbeat save
    }
  }

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

    // Recovery sweep for payments that stalled or missed worker processing during network outage
    const sweep = async () => {
      await this.flushOfflineEvents();
      await reconcileOrphanedPayments().catch((err) =>
        console.error(`[Worker ${this.workerId}] Reconciler error:`, err.message)
      );
    };
    sweep();
    this.reconcileTimer = setInterval(sweep, this.reconcileIntervalMs);

    // Instant recovery trigger when Mongoose reconnects after network outage
    mongoose.connection.on('connected', () => {
      console.log(`[Worker ${this.workerId}] MongoDB reconnected. Triggering instant reconciliation sweep...`);
      sweep();
    });

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
      this.stats.succeeded += 1;
      await this.sendHeartbeat('ONLINE', null, null, 0);
    });

    this.bullWorker.on('failed', (job, err) => this.handleFailedJob(job, err));

    this.bullWorker.on('error', (err) => {
      console.error(`[Worker ${this.workerId}] BullMQ Worker error:`, err.message);
    });

    console.log(`[Worker ${this.workerId}] Ready and actively listening for BullMQ jobs...`);
  }

  async handleFailedJob(job, err) {
    const attempts = job?.attemptsMade || 0;
    const maxAttempts = job?.opts?.attempts || 3;
    const paymentId = job?.data?.paymentId;
    const correlationId = job?.data?.correlationId || null;
    const classified = classifyError(err);

    console.error(
      `[Worker ${this.workerId}] Job ${job?.id} (Payment ${paymentId}) failed on attempt ${attempts}/${maxAttempts}: ${err.message}`
    );

    this.stats.failed += 1;
    await this.sendHeartbeat('ONLINE', null, null, 0);
    if (!paymentId) return;

    const isTerminal = attempts >= maxAttempts || isTerminalFailure(err, job);

    try {
      // Always record WORKER_FAILURE AuditLog for this specific attempt
      await AuditLog.create({
        correlationId,
        actorRole: 'WORKER',
        action: 'WORKER_FAILURE',
        entityType: 'PaymentJob',
        entityId: String(job.id),
        metadata: {
          paymentId,
          jobId: job.id,
          workerId: this.workerId,
          attempt: attempts,
          maxAttempts,
          error: err.message,
          errorCode: classified.code,
          errorCategory: classified.category,
          isSimulated: classified.category === 'SIMULATION',
          message: `Worker exception occurred on attempt ${attempts}/${maxAttempts}: ${err.message}`,
        },
      });

      if (isTerminal) {
        const failureReason = attempts >= maxAttempts
          ? `Exhausted ${attempts}/${maxAttempts} attempts. Error: ${err.message}`
          : err.message;

        await Payment.findByIdAndUpdate(paymentId, {
          $set: {
            status: 'FAILED',
            attempts,
            failureReason,
            errorCode: classified.code,
            errorCategory: classified.category,
          },
        });

        await PaymentJob.findOneAndUpdate(
          { paymentId },
          { $set: { status: 'FAILED', attempts, lastError: err.message, lockedAt: null, lockedBy: null } }
        );

        await AuditLog.create({
          correlationId,
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
            errorCode: classified.code,
            errorCategory: classified.category,
            isRetryable: classified.isRetryable,
            deadLetter: true,
            isSimulated: classified.category === 'SIMULATION',
            message: `Payment permanently FAILED after ${attempts} attempts (Sent to Dead-Letter Queue)`,
          },
        });

        await this.emitSocket('payment_status', {
          paymentId,
          status: 'FAILED',
          failureReason: err.message,
          errorCode: classified.code,
          errorCategory: classified.category,
          attempts,
          correlationId,
        });
      } else {
        // BullMQ exponential backoff
        const base = job?.opts?.backoff?.delay || Number(process.env.RETRY_BACKOFF_DELAY_MS) || 2000;
        const delayMs = base * Math.pow(2, Math.max(attempts - 1, 0));
        const nextAvailableAt = new Date(Date.now() + delayMs);

        this.stats.retried += 1;

        await Payment.findByIdAndUpdate(paymentId, {
          $set: {
            status: 'QUEUED',
            attempts,
            failureReason: `Attempt ${attempts} failed: ${err.message}. Retrying via BullMQ exponential backoff`,
            errorCode: classified.code,
            errorCategory: classified.category,
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
          correlationId,
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
            errorCode: classified.code,
            errorCategory: classified.category,
            isSimulated: classified.category === 'SIMULATION',
            nextAvailableAt,
            retryDelayMs: delayMs,
            message: `BullMQ scheduled retry #${attempts + 1} with exponential backoff (delay: ${delayMs}ms)`,
          },
        });

        await this.emitSocket('payment_status', {
          paymentId,
          status: 'RETRY_SCHEDULED',
          attempt: attempts,
          nextAttempt: attempts + 1,
          errorCode: classified.code,
          errorCategory: classified.category,
          correlationId,
        });
      }
    } catch (dbErr) {
      console.warn(`[Worker ${this.workerId}] Database write offline during job failure recording. Buffering event locally...`);
      this.pendingOfflineEvents.push({
        correlationId,
        jobId: job.id,
        paymentId,
        action: isTerminal ? 'FAILED' : 'WORKER_FAILURE',
        attempts,
        metadata: {
          paymentId,
          jobId: job.id,
          workerId: this.workerId,
          attempt: attempts,
          maxAttempts,
          error: err.message,
          errorCode: classified.code,
          errorCategory: classified.category,
          isSimulated: classified.category === 'SIMULATION',
          message: isTerminal
            ? `Payment permanently FAILED after ${attempts} attempts (Sent to Dead-Letter Queue)`
            : `Worker exception occurred on attempt ${attempts}/${maxAttempts}: ${err.message}`,
        },
      });
    }
  }

  async handleJob(job) {
    const paymentId = job.data?.paymentId;
    if (!paymentId) {
      throw new ValidationError('Job payload missing paymentId');
    }

    const currentAttempt = (job.attemptsMade || 0) + 1;
    this.busyJobs += 1;
    this.stats.processed += 1;

    try {
      // Execute within circuit breaker
      return await paymentWorkerCircuit.execute(() =>
        this.processPayment(job, paymentId, currentAttempt)
      );
    } finally {
      this.busyJobs -= 1;
    }
  }

  /**
   * Runs failure simulation based on SystemConfig toggles.
   * Each simulation type: atomically consumes flag so only ONE job is affected even under concurrency.
   */
  async runFailureSimulations(job, paymentId, currentAttempt, config) {
    // 1. Infrastructure outage (highest priority - blocks everything)
    if (config.simulateOutage) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateOutage: true },
        { $set: { simulateOutage: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Infrastructure Outage`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'INFRASTRUCTURE_OUTAGE', 'Infrastructure outage detected. All services unavailable.');
        throw new InfrastructureOutageError('[SIM] Infrastructure outage: All services unavailable');
      }
    }

    // 2. Network error
    if (config.simulateNetworkError) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateNetworkError: true },
        { $set: { simulateNetworkError: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Network Error`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'NETWORK_ERROR', 'Network connection failed. Payment gateway unreachable.');
        throw new NetworkTransientError('[SIM] Network connection failed: Simulated network drop');
      }
    }

    // 3. Database error
    if (config.simulateDbError) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateDbError: true },
        { $set: { simulateDbError: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Database Failure`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'DATABASE_ERROR', 'Database unavailable. Persistence layer is not responding.');
        throw new DatabaseTransientError('[SIM] Database unavailable: Simulated MongoDB failure');
      }
    }

    // 4. API/Server error
    if (config.simulateServerError) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateServerError: true },
        { $set: { simulateServerError: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Server/API Error`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'SERVER_ERROR', 'Internal server error. Downstream API service failed.');
        throw new ServerTransientError('[SIM] Internal server error: Payment API service failure (HTTP 500)');
      }
    }

    // 5. Timeout
    if (config.simulateTimeout) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateTimeout: true },
        { $set: { simulateTimeout: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Timeout`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'TIMEOUT', 'Operation timed out. Payment outcome is uncertain — will verify before retry.');
        // Simulate timeout check: look up existing transactions to avoid duplicate payment
        const existingTx = await Transaction.find({ paymentId });
        if (existingTx.length > 0) {
          console.log(`[Worker ${this.workerId}] Timeout check: Payment ${paymentId} already committed. Marking SUCCESS.`);
          await Payment.findByIdAndUpdate(paymentId, { $set: { status: 'SUCCESS', failureReason: null } });
          return 'ALREADY_COMMITTED';
        }
        throw new TimeoutTransientError('[SIM] Dependency timeout: Simulated payment gateway timeout (after 30s)');
      }
    }

    // 6. Worker crash simulation
    if (config.simulateWorkerCrash && currentAttempt === 1) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateWorkerCrash: true },
        { $set: { simulateWorkerCrash: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Worker Crash`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'WORKER_CRASH', 'Worker process crashed before completing job. Another worker will take over.');
        throw new SimulatedFailureError('[SIM] Worker crash: Process crashed before transaction commit');
      }
    }

    // 7. Generic worker failure (legacy simulateOneFailure)
    if (config.simulateOneFailure && currentAttempt === 1) {
      const consumed = await SystemConfig.findOneAndUpdate(
        { key: 'DEFAULT_CONFIG', simulateOneFailure: true },
        { $set: { simulateOneFailure: false } }
      );
      if (consumed) {
        console.warn(`[Worker ${this.workerId}] SIMULATED: Worker Fault`);
        await this._recordSimulation(job, paymentId, currentAttempt, 'WORKER_FAILURE', 'Controlled worker failure simulation triggered.');
        throw new SimulatedFailureError('[SIM] Controlled worker failure simulation triggered before transaction commit');
      }
    }

    return null; // No simulation triggered
  }

  async _recordSimulation(job, paymentId, attempt, errorCode, message) {
    try {
      await AuditLog.create({
        actorRole: 'WORKER',
        action: 'WORKER_FAILURE',
        entityType: 'PaymentJob',
        entityId: String(job.id),
        metadata: {
          paymentId,
          jobId: job.id,
          workerId: this.workerId,
          attempt,
          errorCode,
          isSimulated: true,
          message: `[SIMULATED] ${message}`,
        },
      });
    } catch (_) {}
  }

  async processPayment(job, paymentId, currentAttempt) {
    const correlationId = job.data?.correlationId || generateCorrelationId();
    await this.sendHeartbeat('PROCESSING', job.id, paymentId, currentAttempt);
    const config = await this.getConfig();

    console.log(`[Worker ${this.workerId}] [${correlationId}] Claimed BullMQ Job ${job.id}`);
    console.log(`[Worker ${this.workerId}] [${correlationId}] Processing payment ${paymentId} (attempt ${currentAttempt})`);

    await AuditLog.create({
      correlationId,
      actorRole: 'WORKER',
      action: 'WORKER_CLAIMED',
      entityType: 'PaymentJob',
      entityId: String(job.id),
      metadata: {
        paymentId,
        jobId: job.id,
        workerId: this.workerId,
        attempt: currentAttempt,
        correlationId,
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
      correlationId,
      actorRole: 'WORKER',
      action: 'PROCESSING',
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        paymentId,
        jobId: job.id,
        workerId: this.workerId,
        attempt: currentAttempt,
        correlationId,
        message: `Worker is processing payment transaction (Attempt #${currentAttempt})`,
      },
    });

    await this.emitSocket('payment_status', {
      paymentId,
      status: 'PROCESSING',
      workerId: this.workerId,
      attempt: currentAttempt,
      correlationId,
    });

    // Demo-only delay
    const demoDelayMs = config.demoDelayMs ?? 5000;
    if (demoDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, demoDelayMs));
    }

    // Run all failure simulations (atomically consumes flags)
    const simResult = await this.runFailureSimulations(job, paymentId, currentAttempt, config);
    if (simResult === 'ALREADY_COMMITTED') {
      return { status: 'SUCCESS', paymentId, correlationId };
    }

    console.log(`[Worker ${this.workerId}] [${correlationId}] Atomic transaction started`);
    const processingStart = Date.now();
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
        return { status: 'SUCCESS', isDuplicate: true, correlationId };
      }

      const senderWallet = await Wallet.findOne({ userId: payment.senderId }).session(session);
      const recipientWallet = await Wallet.findOne({ userId: payment.recipientId }).session(session);
      if (!senderWallet) throw new RecipientNotFoundError('Sender wallet not found');
      if (!recipientWallet) throw new RecipientNotFoundError('Recipient wallet not found');

      const amount = round2(payment.amount);

      // Conditional atomic debit: succeeds only if balance >= amount
      const debited = await Wallet.findOneAndUpdate(
        { _id: senderWallet._id, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { session, new: true }
      );
      if (!debited) {
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
      payment.errorCode = null;
      payment.errorCategory = null;
      await payment.save({ session });

      await PaymentJob.findOneAndUpdate(
        { paymentId: payment._id },
        { $set: { status: 'SUCCESS', lockedAt: null, lockedBy: null, completedAt: new Date() } },
        { session }
      );

      await session.commitTransaction();
      const processingTimeMs = Date.now() - processingStart;
      console.log(`[Worker ${this.workerId}] [${correlationId}] Atomic transaction committed (${processingTimeMs}ms)`);

      // Post-commit bookkeeping — never fail the job
      try {
        await AuditLog.create({
          correlationId,
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
            correlationId,
            processingTimeMs,
            message: 'Atomic MongoDB transaction committed successfully',
          },
        });
        await this.emitSocket('payment_status', {
          paymentId: payment._id.toString(),
          status: 'SUCCESS',
          amount,
          senderId: payment.senderId.toString(),
          recipientId: payment.recipientId.toString(),
          correlationId,
          processingTimeMs,
        });
      } catch (postErr) {
        console.error(`[Worker ${this.workerId}] Post-commit bookkeeping failed:`, postErr.message);
      }

      console.log(`[Worker ${this.workerId}] [${correlationId}] Payment SUCCESS`);
      return { status: 'SUCCESS', paymentId: payment._id.toString(), correlationId };
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
          return { status: 'SUCCESS', duplicateDetected: true, correlationId };
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
