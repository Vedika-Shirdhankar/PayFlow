const express = require('express');
const router = express.Router();
const User = require('../models/User');
const TransactionLimit = require('../models/TransactionLimit');
const { authenticateToken } = require('../middleware/auth');

// GET /api/users/recipients - Authenticated users get eligible recipients list
router.get('/recipients', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } })
      .select('name email role')
      .sort({ name: 1 });

    const recipients = users.map((u) => ({
      id: u._id.toString(),
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
    }));

    return res.json(recipients);
  } catch (error) {
    console.error('Error fetching recipients:', error);
    return res.status(500).json({ error: 'Failed to fetch eligible payment recipients' });
  }
});

// GET /api/users - General authenticated users list alias
router.get('/', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } })
      .select('name email role')
      .sort({ name: 1 });

    const recipients = users.map((u) => ({
      id: u._id.toString(),
      _id: u._id.toString(),
      name: u.name,
      email: u.email,
    }));

    return res.json(recipients);
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users list' });
  }
});

// GET /api/users/me/limits - Get own transaction limits
router.get('/me/limits', authenticateToken, async (req, res) => {
  try {
    let limits = await TransactionLimit.findOne({ userId: req.user.userId });
    if (!limits) {
      limits = { perPaymentLimit: 0, dailyLimit: 0 };
    }
    return res.json({
      perPaymentLimit: limits.perPaymentLimit,
      dailyLimit: limits.dailyLimit,
    });
  } catch (error) {
    console.error('getLimits error:', error);
    return res.status(500).json({ error: 'Failed to fetch limits' });
  }
});

// PUT /api/users/me/limits - Set own transaction limits
router.put('/me/limits', authenticateToken, async (req, res) => {
  try {
    const { perPaymentLimit, dailyLimit } = req.body;
    const update = {};

    if (perPaymentLimit !== undefined) {
      const val = Number(perPaymentLimit);
      if (isNaN(val) || val < 0) return res.status(400).json({ error: 'perPaymentLimit must be a non-negative number (0 = no limit)' });
      update.perPaymentLimit = val;
    }
    if (dailyLimit !== undefined) {
      const val = Number(dailyLimit);
      if (isNaN(val) || val < 0) return res.status(400).json({ error: 'dailyLimit must be a non-negative number (0 = no limit)' });
      update.dailyLimit = val;
    }

    const limits = await TransactionLimit.findOneAndUpdate(
      { userId: req.user.userId },
      { $set: update },
      { upsert: true, new: true }
    );

    return res.json({
      message: 'Transaction limits updated',
      perPaymentLimit: limits.perPaymentLimit,
      dailyLimit: limits.dailyLimit,
    });
  } catch (error) {
    console.error('setLimits error:', error);
    return res.status(500).json({ error: 'Failed to update limits' });
  }
});

module.exports = router;
