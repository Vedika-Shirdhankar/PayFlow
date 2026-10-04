const { v4: uuidv4 } = require('crypto');

const generateCorrelationId = () => {
  if (uuidv4) {
    try {
      return `corr-${uuidv4().substring(0, 13)}`;
    } catch (e) {
      // Fallback
    }
  }
  return `corr-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
};

const tracingMiddleware = (req, res, next) => {
  let correlationId = req.headers['x-correlation-id'] || req.headers['correlation-id'];
  if (!correlationId || typeof correlationId !== 'string' || !correlationId.trim()) {
    correlationId = generateCorrelationId();
  } else {
    correlationId = correlationId.trim();
  }

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
};

module.exports = {
  tracingMiddleware,
  generateCorrelationId,
};
