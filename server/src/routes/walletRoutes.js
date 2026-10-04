const express = require('express');
const router = express.Router();
const { getWallet, getTransactions } = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, getWallet);
router.get('/transactions', authenticateToken, getTransactions);

module.exports = router;
