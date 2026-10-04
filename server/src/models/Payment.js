const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Payment amount must be greater than 0'],
    },
    currency: {
      type: String,
      default: 'USD',
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['CREATED', 'QUEUED', 'PROCESSING', 'SUCCESS', 'FAILED'],
      default: 'QUEUED',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    failureReason: {
      type: String,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
    },
    errorCategory: {
      type: String,
      default: null,
    },
    correlationId: {
      type: String,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    // User annotations
    note: {
      type: String,
      default: null,
      maxlength: [200, 'Note cannot exceed 200 characters'],
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 5 && arr.every((t) => t.length <= 30),
        message: 'Maximum 5 tags, each up to 30 characters',
      },
    },
    // Refund tracking
    refundStatus: {
      type: String,
      enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'],
      default: 'NONE',
    },
  },
  {
    timestamps: true,
  }
);

// Ensure senderId + idempotencyKey combination is unique
paymentSchema.index({ senderId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('Payment', paymentSchema);
