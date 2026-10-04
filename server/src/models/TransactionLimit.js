const mongoose = require('mongoose');

const transactionLimitSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Max single payment amount (0 = no limit)
    perPaymentLimit: {
      type: Number,
      default: 0,
      min: [0, 'Per-payment limit cannot be negative'],
    },
    // Max total outgoing per calendar day (0 = no limit)
    dailyLimit: {
      type: Number,
      default: 0,
      min: [0, 'Daily limit cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('TransactionLimit', transactionLimitSchema);
