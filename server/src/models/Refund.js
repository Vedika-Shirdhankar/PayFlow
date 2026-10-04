const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Amount to refund (≤ original payment amount)
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Refund amount must be greater than 0'],
    },
    reason: {
      type: String,
      required: true,
      maxlength: [500, 'Reason cannot exceed 500 characters'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED'],
      default: 'PENDING',
    },
    // Admin note (for approvals or rejections)
    adminNote: {
      type: String,
      default: null,
      maxlength: [500, 'Admin note cannot exceed 500 characters'],
    },
    // The reverse payment created when refund is approved and executed
    refundPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// One pending refund per payment at a time
refundSchema.index({ paymentId: 1, status: 1 });

module.exports = mongoose.model('Refund', refundSchema);
