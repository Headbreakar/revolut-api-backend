import crypto from 'crypto';

/**
 * API Key Authentication Middleware
 */
export const authenticateApiKey = (req, res, next) => {
  const isRequired = process.env.API_KEY_REQUIRED === 'true';

  if (!isRequired) {
    return next();
  }

  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];
  
  let bearerKey = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerKey = authHeader.substring(7).trim();
  }

  const providedKey = apiKeyHeader || bearerKey;
  const configuredKey = process.env.API_KEY || 'revolut_secret_api_key_12345';

  if (!providedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API Key missing. Provide x-api-key header or Authorization: Bearer <key>'
    });
  }

  if (providedKey !== configuredKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API Key provided'
    });
  }

  next();
};

/**
 * Webhook Signature Verification Middleware
 * Validates HMAC SHA-256 signature against Revolut-Request-Timestamp and raw body payload.
 */
export const verifyWebhookSignature = (req, res, next) => {
  const signingSecret = process.env.REVOLUT_SIGNING_SECRET || 'whsec_test_secret_key_123456789';
  const timestamp = req.headers['revolut-request-timestamp'];
  const receivedSignature = req.headers['revolut-signature'];

  if (!timestamp || !receivedSignature) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Revolut-Request-Timestamp or Revolut-Signature header'
    });
  }

  // Prevent replay attacks (check if timestamp older than 5 mins)
  const timestampMs = parseInt(timestamp, 10);
  const currentMs = Date.now();
  if (isNaN(timestampMs) || Math.abs(currentMs - timestampMs) > 5 * 60 * 1000) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Webhook request timestamp expired or invalid'
    });
  }

  // Get raw body string for accurate HMAC calculation
  const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  const payloadToSign = `v1.${timestamp}.${rawBody}`;
  
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', signingSecret)
    .update(payloadToSign)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(receivedSignature);

  // Buffer length check to prevent timingSafeEqual throwing RangeError
  if (expectedBuf.length !== receivedBuf.length) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid webhook signature length'
    });
  }

  // Timing safe comparison to prevent timing attacks
  const isValid = crypto.timingSafeEqual(expectedBuf, receivedBuf);

  req.isSignatureValid = isValid;

  if (!isValid) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid webhook signature'
    });
  }

  next();
};
