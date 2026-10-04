const jwt = require('jsonwebtoken');
const Payment = require('../models/Payment');
const User = require('../models/User');

/**
 * Socket.IO handshake auth: client sends { auth: { token } }.
 * Authenticated sockets join `user:<id>` (and `admin` for admins).
 */
const attachSocketAuth = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('role');
      if (!user) return next(new Error('User no longer exists'));
      socket.data.user = { userId: user._id.toString(), role: user.role };
      return next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data.user;
    socket.join(`user:${userId}`);
    if (role === 'ADMIN') socket.join('admin');
    console.log(`[Socket.IO] ${role} ${userId} connected (${socket.id})`);
    socket.on('disconnect', () => console.log(`[Socket.IO] ${userId} disconnected (${socket.id})`));
  });
};

/**
 * Forward a Redis-published event to only the sender, recipient and admins.
 */
const routePaymentEvent = async (io, event, payload) => {
  try {
    let { senderId, recipientId } = payload;
    if ((!senderId || !recipientId) && payload.paymentId) {
      const p = await Payment.findById(payload.paymentId).select('senderId recipientId').lean();
      if (p) {
        senderId = p.senderId.toString();
        recipientId = p.recipientId.toString();
      }
    }
    const rooms = ['admin'];
    if (senderId) rooms.push(`user:${senderId}`);
    if (recipientId) rooms.push(`user:${recipientId}`);

    // Only send what the UI needs; never broadcast amounts to unrelated users.
    io.to(rooms).emit(event, payload);
  } catch (err) {
    console.error('Failed to route realtime event:', err.message);
  }
};

module.exports = { attachSocketAuth, routePaymentEvent };
