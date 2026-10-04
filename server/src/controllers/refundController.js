const Refund = require('../models/Refund');
const Payment = require('../models/Payment');
const Wallet = require('../models/Wallet');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');
const { publishEvent } = require('../config/redis');

/**
 * POST /payments/:paymentId/refund
 * User requests a refund on their own SUCCESS payment.
 */
const requestRefund = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason, amount } = req.body;
    const userId = req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment ID' });
    }

    const payment = await Payment.findById(paymentId)
      .populate('senderId', 'name email')
      .populate('recipientId', 'name email');

    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.senderId._id.toString() !== userId) {
      return res.status(403).json({ error: 'Only the sender can request a refund' });
    }
    if (payment.status !== 'SUCCESS') {
      return res.status(400).json({ error: 'Refunds can only be requested for completed (SUCCESS) payments' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required for a refund request' });
    }

    // Check for duplicate pending/approved refund
    const existingRefund = await Refund.findOne({
      paymentId,
      status: { $in: ['PENDING', 'APPROVED', 'PROCESSING'] },
    });
    if (existingRefund) {
      return res.status(409).json({
        error: 'A refund request is already in progress for this payment',
        refundId: existingRefund._id,
        status: existingRefund.status,
      });
    }

    // Validate amount
    const refundAmount = amount ? Number(amount) : payment.amount;
    if (isNaN(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ error: 'Refund amount must be a positive number' });
    }
    if (refundAmount > payment.amount) {
      return res.status(400).json({
        error: `Refund amount ($${refundAmount.toFixed(2)}) cannot exceed original payment amount ($${payment.amount.toFixed(2)})`,
      });
    }

    const refund = await Refund.create({
      paymentId,
      requestedBy: userId,
      amount: refundAmount,
      reason: reason.trim().substring(0, 500),
      status: 'PENDING',
    });

    // Mark payment refundStatus
    await Payment.findByIdAndUpdate(paymentId, { $set: { refundStatus: 'PENDING' } });

    await AuditLog.create({
      actorId: userId,
      actorRole: req.user.role,
      action: 'REFUND_REQUESTED',
      entityType: 'Refund',
      entityId: refund._id.toString(),
      metadata: {
        paymentId,
        amount: refundAmount,
        reason: refund.reason,
        message: `User requested refund of $${refundAmount.toFixed(2)} for payment ${paymentId}`,
      },
    });

    await publishEvent('refund_update', {
      refundId: refund._id.toString(),
      paymentId,
      status: 'PENDING',
      userId,
    });

    return res.status(201).json({
      message: 'Refund request submitted successfully. Awaiting admin review.',
      refund: {
        id: refund._id,
        paymentId,
        amount: refundAmount,
        reason: refund.reason,
        status: refund.status,
        createdAt: refund.createdAt,
      },
    });
  } catch (error) {
    console.error('requestRefund error:', error);
    return res.status(500).json({ error: 'Failed to submit refund request' });
  }
};

/**
 * GET /payments/:paymentId/refund
 * Get refund status for a specific payment.
 */
const getRefundForPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ error: 'Invalid payment ID' });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (
      req.user.role !== 'ADMIN' &&
      payment.senderId.toString() !== req.user.userId &&
      payment.recipientId.toString() !== req.user.userId
    ) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const refund = await Refund.findOne({ paymentId })
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });

    return res.json({ refund: refund || null });
  } catch (error) {
    console.error('getRefundForPayment error:', error);
    return res.status(500).json({ error: 'Failed to fetch refund' });
  }
};

/**
 * GET /refunds
 * Get authenticated user's own refund requests.
 */
const getUserRefunds = async (req, res) => {
  try {
    const refunds = await Refund.find({ requestedBy: req.user.userId })
      .populate('paymentId')
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({ refunds });
  } catch (error) {
    console.error('getUserRefunds error:', error);
    return res.status(500).json({ error: 'Failed to fetch refunds' });
  }
};

/**
 * GET /admin/refunds
 * All refund requests (admin only).
 */
const getAllRefunds = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const refunds = await Refund.find(query)
      .populate('paymentId')
      .populate('requestedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ refunds, count: refunds.length });
  } catch (error) {
    console.error('getAllRefunds error:', error);
    return res.status(500).json({ error: 'Failed to fetch refunds' });
  }
};

/**
 * POST /admin/refunds/:refundId/approve
 * Admin approves refund — executes reverse wallet transfer atomically.
 */
const approveRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { refundId } = req.params;
    const { adminNote } = req.body;
    const adminId = req.user.userId;

    const refund = await Refund.findById(refundId)
      .populate('paymentId')
      .session(session);

    if (!refund) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Refund not found' });
    }
    if (refund.status !== 'PENDING') {
      await session.abortTransaction();
      return res.status(400).json({ error: `Cannot approve a refund with status '${refund.status}'` });
    }

    const originalPayment = refund.paymentId;
    if (!originalPayment) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Original payment not found' });
    }

    const refundAmount = refund.amount;

    // Reverse the wallet balances atomically
    const recipientWallet = await Wallet.findOne({ userId: originalPayment.recipientId }).session(session);
    const senderWallet = await Wallet.findOne({ userId: originalPayment.senderId }).session(session);

    if (!recipientWallet || !senderWallet) {
      await session.abortTransaction();
      return res.status(500).json({ error: 'Wallet not found for refund parties' });
    }
    if (recipientWallet.balance < refundAmount) {
      await session.abortTransaction();
      return res.status(400).json({
        error: `Recipient's wallet has insufficient balance ($${recipientWallet.balance.toFixed(2)}) to process the $${refundAmount.toFixed(2)} refund`,
      });
    }

    // Debit recipient, credit sender
    recipientWallet.balance = parseFloat((recipientWallet.balance - refundAmount).toFixed(2));
    senderWallet.balance = parseFloat((senderWallet.balance + refundAmount).toFixed(2));
    await recipientWallet.save({ session });
    await senderWallet.save({ session });

    // Create a marker refund Payment record
    const refundPayment = await Payment.create(
      [{
        senderId: originalPayment.recipientId,
        recipientId: originalPayment.senderId,
        amount: refundAmount,
        currency: originalPayment.currency || 'USD',
        idempotencyKey: `REFUND-${refund._id}-${Date.now()}`,
        status: 'SUCCESS',
        completedAt: new Date(),
        note: `Refund for payment ${originalPayment._id.toString().substring(0, 8)}…`,
        tags: ['Refund'],
      }],
      { session }
    );

    // Update the refund document
    await Refund.findByIdAndUpdate(
      refundId,
      {
        $set: {
          status: 'COMPLETED',
          adminNote: adminNote?.trim().substring(0, 500) || null,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          completedAt: new Date(),
          refundPaymentId: refundPayment[0]._id,
        },
      },
      { session }
    );

    // Mark original payment refundStatus = COMPLETED
    await Payment.findByIdAndUpdate(
      originalPayment._id,
      { $set: { refundStatus: 'COMPLETED' } },
      { session }
    );

    await session.commitTransaction();

    await AuditLog.create({
      actorId: adminId,
      actorRole: req.user.role,
      action: 'REFUND_APPROVED',
      entityType: 'Refund',
      entityId: refundId,
      metadata: {
        originalPaymentId: originalPayment._id.toString(),
        refundPaymentId: refundPayment[0]._id.toString(),
        amount: refundAmount,
        adminNote: adminNote || null,
      },
    });

    await publishEvent('refund_update', {
      refundId,
      paymentId: originalPayment._id.toString(),
      status: 'COMPLETED',
    });

    return res.json({
      message: `Refund of $${refundAmount.toFixed(2)} approved and processed successfully`,
      refundPaymentId: refundPayment[0]._id,
      newSenderBalance: senderWallet.balance,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('approveRefund error:', error);
    return res.status(500).json({ error: 'Failed to approve refund' });
  } finally {
    session.endSession();
  }
};

/**
 * POST /admin/refunds/:refundId/reject
 * Admin rejects refund request.
 */
const rejectRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { adminNote } = req.body;
    const adminId = req.user.userId;

    const refund = await Refund.findById(refundId).populate('paymentId');
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot reject a refund with status '${refund.status}'` });
    }

    await Refund.findByIdAndUpdate(refundId, {
      $set: {
        status: 'REJECTED',
        adminNote: adminNote?.trim().substring(0, 500) || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    // Mark payment refundStatus = REJECTED
    await Payment.findByIdAndUpdate(refund.paymentId._id, { $set: { refundStatus: 'REJECTED' } });

    await AuditLog.create({
      actorId: adminId,
      actorRole: req.user.role,
      action: 'REFUND_REJECTED',
      entityType: 'Refund',
      entityId: refundId,
      metadata: {
        originalPaymentId: refund.paymentId._id.toString(),
        amount: refund.amount,
        adminNote: adminNote || null,
      },
    });

    await publishEvent('refund_update', {
      refundId,
      paymentId: refund.paymentId._id.toString(),
      status: 'REJECTED',
    });

    return res.json({ message: 'Refund request rejected', refundId, adminNote: adminNote || null });
  } catch (error) {
    console.error('rejectRefund error:', error);
    return res.status(500).json({ error: 'Failed to reject refund' });
  }
};

module.exports = {
  requestRefund,
  getRefundForPayment,
  getUserRefunds,
  getAllRefunds,
  approveRefund,
  rejectRefund,
};
