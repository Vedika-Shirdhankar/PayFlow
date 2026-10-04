const Payment = require('../models/Payment');
const PaymentJob = require('../models/PaymentJob');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const AuditLog = require('../models/AuditLog');
const Transaction = require('../models/Transaction');
const WorkerHeartbeat = require('../models/WorkerHeartbeat');
const { addPaymentJob, getQueueStats } = require('../queue/paymentQueue');
const { publishEvent } = require('../config/redis');
const { parseAmount, validateIdempotencyKey } = require('../utils/validation');
const mongoose = require('mongoose');

const createPayment = async (req, res) => {
  try {
    const senderId = req.user.userId;
    const { recipientId, amount, idempotencyKey } = req.body;

    // Terminal Log
    console.log(`[API] Payment request received`);

    // 1. Synchronous Input Validation
    if (!recipientId || amount === undefined || amount === null || amount === '' || !idempotencyKey) {
      return res.status(400).json({ error: 'recipientId, amount, and idempotencyKey are required' });
    }
    if (typeof recipientId !== 'string') {
      return res.status(400).json({ error: 'recipientId must be a user id or email string' });
    }

    const parsedAmount = parseAmount(amount);
    if (!parsedAmount.ok) {
      return res.status(400).json({ error: parsedAmount.error });
    }
    const numAmount = parsedAmount.value;

    const keyCheck = validateIdempotencyKey(idempotencyKey);
    if (!keyCheck.ok) {
      return res.status(400).json({ error: keyCheck.error });
    }
    const cleanKey = keyCheck.value;

    // Find recipient user by ObjectId or email address
    let recipient;
    if (mongoose.Types.ObjectId.isValid(recipientId)) {
      recipient = await User.findById(recipientId);
    }
    if (!recipient) {
      recipient = await User.findOne({ email: recipientId.toLowerCase() });
    }

    if (!recipient) {
      return res.status(404).json({ error: 'Recipient user does not exist. Please select a user or enter a valid email.' });
    }

    const targetRecipientId = recipient._id.toString();

    if (senderId === targetRecipientId) {
      return res.status(400).json({ error: 'Sender and recipient cannot be the same user' });
    }

    // 2. IDEMPOTENCY CHECK (Must happen BEFORE balance check)
    const existingPayment = await Payment.findOne({ senderId, idempotencyKey: cleanKey });
    if (existingPayment) {
      // Same key with a different payload is a client bug -> 409, never silently reuse
      if (
        existingPayment.recipientId.toString() !== targetRecipientId ||
        Math.round(existingPayment.amount * 100) !== Math.round(numAmount * 100)
      ) {
        return res.status(409).json({
          error: 'This idempotency key was already used for a different payment (different recipient or amount). Generate a new key.',
          paymentId: existingPayment._id,
        });
      }
      const existingJob = await PaymentJob.findOne({ paymentId: existingPayment._id });
      const statusMessage =
        existingPayment.status === 'SUCCESS'
          ? 'Original payment was already completed successfully'
          : `Payment request already submitted (Status: ${existingPayment.status})`;

      return res.status(200).json({
        message: statusMessage,
        isDuplicate: true,
        paymentId: existingPayment._id,
        status: existingPayment.status,
        attempts: existingJob ? existingJob.attempts : existingPayment.attempts,
        createdAt: existingPayment.createdAt,
      });
    }

    // 3. Sender Wallet Balance Pre-Check (Only evaluated for NEW requests)
    const senderWallet = await Wallet.findOne({ userId: senderId });
    const availableBalance = senderWallet ? senderWallet.balance : 0;
    if (availableBalance < numAmount) {
      return res.status(400).json({
        message: 'Insufficient balance',
        availableBalance,
        requestedAmount: numAmount,
      });
    }

    // 4. Create Payment record in MongoDB (Status: QUEUED)
    const payment = await Payment.create({
      senderId,
      recipientId: targetRecipientId,
      amount: numAmount,
      currency: 'USD',
      idempotencyKey: cleanKey,
      status: 'QUEUED',
      attempts: 0,
    });

    // 5. Add Job to BullMQ Queue (Redis)
    let job;
    let paymentJob;
    try {
      ({ job, paymentJob } = await addPaymentJob(payment._id));
    } catch (queueErr) {
      console.error('Failed to enqueue payment job:', queueErr.message);
      await Payment.findByIdAndUpdate(payment._id, {
        $set: { status: 'FAILED', failureReason: 'Queue unavailable. Payment was not processed; please retry.' },
      });
      return res.status(503).json({ error: 'Payment queue is unavailable. Your wallet was not charged. Please retry.' });
    }

    // Terminal Log
    console.log(`[API] PaymentJob enqueued to BullMQ (Redis) - Job ID: ${job.id}`);

    // 6. Create Standardized Audit Logs (REQUESTED & QUEUED)
    await AuditLog.create([
      {
        actorId: senderId,
        actorRole: req.user.role,
        action: 'REQUESTED',
        entityType: 'Payment',
        entityId: payment._id.toString(),
        metadata: {
          paymentId: payment._id.toString(),
          jobId: job.id,
          recipientId: targetRecipientId,
          amount: numAmount,
          idempotencyKey: cleanKey,
          message: 'API received payment request',
        },
      },
      {
        actorId: senderId,
        actorRole: req.user.role,
        action: 'QUEUED',
        entityType: 'PaymentJob',
        entityId: paymentJob._id.toString(),
        metadata: {
          paymentId: payment._id.toString(),
          jobId: job.id,
          queueName: 'payment-processing',
          availableAt: paymentJob.availableAt,
          message: 'PaymentJob enqueued to BullMQ / Redis queue',
        },
      },
    ]);

    // Realtime update (API -> Redis -> Socket.IO rooms of sender, recipient, admins)
    await publishEvent('payment_status', {
      paymentId: payment._id.toString(),
      status: 'QUEUED',
      senderId,
      recipientId: targetRecipientId,
    });

    // 7. Terminal Log & HTTP 202 Accepted
    console.log(`[API] Returning HTTP 202 Accepted`);
    return res.status(202).json({
      message: 'Payment accepted and queued for BullMQ worker processing.',
      paymentId: payment._id,
      status: 'QUEUED',
      jobId: job.id,
      amount: payment.amount,
      currency: payment.currency,
      recipientId: payment.recipientId,
      idempotencyKey: payment.idempotencyKey,
    });
  } catch (error) {
    if (error.code === 11000) {
      const existingPayment = await Payment.findOne({
        senderId: req.user.userId,
        idempotencyKey: typeof req.body.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : req.body.idempotencyKey,
      });
      if (existingPayment) {
        return res.status(200).json({
          message:
            existingPayment.status === 'SUCCESS'
              ? 'Original payment was already completed successfully'
              : `Payment request already submitted (Status: ${existingPayment.status})`,
          isDuplicate: true,
          paymentId: existingPayment._id,
          status: existingPayment.status,
        });
      }
    }
    console.error('createPayment error:', error);
    return res.status(500).json({ error: `Failed to enqueue payment: ${error.message}` });
  }
};

const getPayments = async (req, res) => {
  try {
    const { status, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const query = {};

    if (req.user.role !== 'ADMIN') {
      query.$or = [{ senderId: req.user.userId }, { recipientId: req.user.userId }];
    }

    if (status) {
      query.status = status;
    }

    if (search) {
      // Search is by Payment ID; an invalid id can never match anything
      if (!mongoose.Types.ObjectId.isValid(search)) {
        return res.json({ payments: [], total: 0, page: 1, pages: 1 });
      }
      query._id = search;
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('senderId', 'name email')
        .populate('recipientId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Payment.countDocuments(query),
    ]);

    return res.json({
      payments,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('getPayments error:', error);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

const getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment ID format' });
    }

    const payment = await Payment.findById(paymentId)
      .populate('senderId', 'name email')
      .populate('recipientId', 'name email');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (
      req.user.role !== 'ADMIN' &&
      payment.senderId._id.toString() !== req.user.userId &&
      payment.recipientId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({ error: 'Access denied to this payment details' });
    }

    const job = await PaymentJob.findOne({ paymentId: payment._id });
    const transactions = await Transaction.find({ paymentId: payment._id });
    const auditLogs = await AuditLog.find({
      $or: [{ entityId: payment._id.toString() }, { 'metadata.paymentId': payment._id.toString() }],
    }).sort({ createdAt: 1 });

    return res.json({
      payment,
      job,
      transactions,
      auditLogs,
    });
  } catch (error) {
    console.error('getPaymentById error:', error);
    return res.status(500).json({ error: 'Failed to fetch payment details' });
  }
};

const getPaymentTrace = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment ID format' });
    }

    const payment = await Payment.findById(paymentId)
      .populate('senderId', 'name email')
      .populate('recipientId', 'name email');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (
      req.user.role !== 'ADMIN' &&
      payment.senderId._id.toString() !== req.user.userId &&
      payment.recipientId._id.toString() !== req.user.userId
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const job = await PaymentJob.findOne({ paymentId: payment._id });
    const transactions = await Transaction.find({ paymentId: payment._id });

    // Retrieve all AuditLogs matching paymentId or jobId from MongoDB
    const auditLogs = await AuditLog.find({
      $or: [
        { entityId: payment._id.toString() },
        { 'metadata.paymentId': payment._id.toString() },
        ...(job ? [{ entityId: job._id.toString() }, { 'metadata.jobId': job._id.toString() }] : []),
      ],
    }).sort({ createdAt: 1 });

    // Map real backend event log objects
    let timeline = auditLogs.map((log) => {
      const isApiEvent =
        log.action === 'REQUESTED' ||
        log.action === 'PAYMENT_CREATED' ||
        log.action === 'QUEUED' ||
        log.action === 'PAYMENT_QUEUED' ||
        log.action === 'PAYMENT_REPLAYED';
      return {
        event: log.action,
        timestamp: log.createdAt,
        status: log.metadata?.status || log.action,
        workerId: isApiEvent ? null : log.metadata?.workerId || job?.lockedBy || null,
        attempt: log.metadata?.attempt || log.metadata?.attempts || (job ? job.attempts : 1),
        message: log.metadata?.message || null,
        error: log.metadata?.error || log.metadata?.failureReason || null,
        details: log.metadata,
      };
    });

    // If payment is SUCCESS, truncate timeline at the first SUCCESS event to eliminate post-commit noise
    const successIndex = timeline.findIndex((t) => t.event === 'SUCCESS' || t.event === 'PAYMENT_SUCCESS');
    if (successIndex !== -1 && payment.status === 'SUCCESS') {
      timeline = timeline.slice(0, successIndex + 1);
    }

    // Integrity verification metrics
    const debitCount = transactions.filter((t) => t.type === 'DEBIT').length;
    const creditCount = transactions.filter((t) => t.type === 'CREDIT').length;

    const duplicatePaymentsCount = await Payment.countDocuments({
      senderId: payment.senderId._id || payment.senderId,
      idempotencyKey: payment.idempotencyKey,
    });

    const integrity = {
      debitCount,
      creditCount,
      committedPayment: payment.status === 'SUCCESS' ? 1 : 0,
      noDuplicateDebit: debitCount <= 1,
      idempotencyProtection: duplicatePaymentsCount <= 1 ? 'ENFORCED' : 'VIOLATED',
      atomicWalletUpdate:
        payment.status === 'SUCCESS' ? (debitCount === 1 && creditCount === 1 ? 'PASSED' : 'FAILED') : 'PENDING',
      recoveryStatus: (job && job.attempts > 1) || payment.attempts > 1 ? 'PASSED' : 'NOT_REQUIRED',
    };

    // Worker Status Evaluation
    const timeoutMs = Number(process.env.WORKER_HEARTBEAT_TIMEOUT) || 6000;
    const allWorkers = await WorkerHeartbeat.find().sort({ lastHeartbeat: -1 });

    let workerStatusText = 'No worker registered';
    let activeWorker = null;

    if (allWorkers.length > 0) {
      activeWorker = allWorkers[0];
      const timeSinceHeartbeat = Date.now() - new Date(activeWorker.lastHeartbeat).getTime();
      if (activeWorker.status === 'OFFLINE' || timeSinceHeartbeat > timeoutMs) {
        workerStatusText = 'Worker Offline';
      } else {
        workerStatusText = activeWorker.status; // 'ONLINE' or 'PROCESSING'
      }
    }

    const queueStats = await getQueueStats();

    return res.json({
      payment: {
        id: payment._id,
        idempotencyKey: payment.idempotencyKey,
        sender: payment.senderId,
        recipient: payment.recipientId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        failureReason: payment.failureReason,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        completedAt: payment.completedAt,
      },
      job: job
        ? {
            id: job._id,
            status: job.status,
            workerId: job.lockedBy,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            lastError: job.lastError,
          }
        : null,
      workerStatus: {
        statusText: workerStatusText,
        isOnline: workerStatusText === 'ONLINE' || workerStatusText === 'PROCESSING',
        workerId: activeWorker ? activeWorker.workerId : null,
        processId: activeWorker ? activeWorker.processId : null,
        lastHeartbeat: activeWorker ? activeWorker.lastHeartbeat : null,
        startedAt: activeWorker ? activeWorker.startedAt : null,
        queueStats: {
          queued: queueStats.waiting + queueStats.delayed,
          processing: queueStats.active,
          completed: queueStats.completed,
          failed: queueStats.failed,
          total: queueStats.total,
        },
      },
      timeline,
      integrity,
      transactions,
    });
  } catch (error) {
    console.error('getPaymentTrace error:', error);
    return res.status(500).json({ error: 'Failed to fetch payment trace' });
  }
};

module.exports = {
  createPayment,
  getPayments,
  getPaymentById,
  getPaymentTrace,
};
