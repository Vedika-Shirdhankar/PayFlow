const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const AuditLog = require('../models/AuditLog');
const { validateEmail, validatePassword, validateName } = require('../utils/validation');
const { isNetworkOrDbConnectionError } = require('../utils/errors');

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!validateName(name)) {
      return res.status(400).json({ error: 'Name must be between 2 and 80 characters' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'USER',
    });

    // Create wallet with zero balance automatically
    const wallet = await Wallet.create({
      userId: user._id,
      balance: 0,
      currency: 'USD',
    });

    // Create Audit Logs
    await AuditLog.create([
      {
        actorId: user._id,
        actorRole: user.role,
        action: 'USER_REGISTERED',
        entityType: 'User',
        entityId: user._id.toString(),
        metadata: { email: user.email, name: user.name },
      },
      {
        actorId: user._id,
        actorRole: user.role,
        action: 'WALLET_CREATED',
        entityType: 'Wallet',
        entityId: wallet._id.toString(),
        metadata: { initialBalance: 0, currency: 'USD' },
      },
    ]);

    const token = generateToken(user);

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      wallet: {
        id: wallet._id,
        balance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Server error during registration' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password must be strings' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const wallet = await Wallet.findOne({ userId: user._id });

    // Create audit log
    await AuditLog.create({
      actorId: user._id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user._id.toString(),
      metadata: { email: user.email },
    });

    const token = generateToken(user);

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      wallet: wallet
        ? {
            id: wallet._id,
            balance: wallet.balance,
            currency: wallet.currency,
          }
        : null,
    });
  } catch (error) {
    console.error('Login error:', error);
    if (isNetworkOrDbConnectionError(error)) {
      return res.status(503).json({
        error: 'Database connection failed. Please check your internet / network connection and try again.',
        code: 'AUTH_DB_UNAVAILABLE',
      });
    }
    return res.status(500).json({ error: error.message || 'Server error during login' });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const wallet = await Wallet.findOne({ userId: user._id });

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      wallet: wallet
        ? {
            id: wallet._id,
            balance: wallet.balance,
            currency: wallet.currency,
          }
        : null,
    });
  } catch (error) {
    console.error('GetMe error:', error);
    return res.status(500).json({ error: 'Server error fetching user profile' });
  }
};

module.exports = {
  register,
  login,
  getMe,
};
