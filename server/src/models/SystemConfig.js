const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'DEFAULT_CONFIG',
      unique: true,
    },
    demoDelayMs: {
      type: Number,
      default: 5000,
    },
    simulateOneFailure: {
      type: Boolean,
      default: false,
    },
    simulateNetworkError: {
      type: Boolean,
      default: false,
    },
    simulateDbError: {
      type: Boolean,
      default: false,
    },
    simulateTimeout: {
      type: Boolean,
      default: false,
    },
    simulateServerError: {
      type: Boolean,
      default: false,
    },
    simulateWorkerCrash: {
      type: Boolean,
      default: false,
    },
    simulateOutage: {
      type: Boolean,
      default: false,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
