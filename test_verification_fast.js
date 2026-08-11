import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import paymentRoutes from './src/routes/paymentRoutes.js';
import errorHandler from './src/middleware/errorHandler.js';
import Order from './src/models/Order.js';
import Payment from './src/models/Payment.js';
import Refund from './src/models/Refund.js';
import WebhookEvent from './src/models/WebhookEvent.js';
import Customer from './src/models/Customer.js';

async function runVerification() {
  console.log('=== Starting Payment System API & Webhook Verification \n');

  const mockOrders = new Map();
  const mockPayments = new Map();
  const mockRefunds = new Map();
  const mockWebhookEvents = new Map();

  Order.findOne = async (query) => {
    if (query.$or) {
      for (const cond of query.$or) {
        if (cond.reference && mockOrders.has(cond.reference)) return mockOrders.get(cond.reference);
        if (cond.revolutOrderId && mockOrders.has(cond.revolutOrderId)) return mockOrders.get(cond.revolutOrderId);
      }
    }
    if (query.reference && mockOrders.has(query.reference)) return mockOrders.get(query.reference);
    if (query.revolutOrderId && mockOrders.has(query.revolutOrderId)) return mockOrders.get(query.revolutOrderId);
    return null;
  };

  Order.create = async (doc) => {
    const record = {
      _id: `obj_${Date.now()}_${Math.random()}`,
      ...doc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      save: async function() {
        mockOrders.set(this.revolutOrderId, this);
        mockOrders.set(this.reference, this);
        return this;
      }
    };
    mockOrders.set(record.revolutOrderId, record);
    mockOrders.set(record.reference, record);
    return record;
  };

  Order.countDocuments = async () => mockOrders.size / 2;
  Order.find = () => ({
    sort: () => ({
      skip: () => ({
        limit: async () => Array.from(new Set(mockOrders.values()))
      })
    })
  });

  Customer.findOneAndUpdate = async () => ({ email: 'test@example.com' });

  Payment.create = async (doc) => {
    const record = {
      _id: `pay_${Date.now()}`,
      ...doc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mockPayments.set(record.revolutPaymentId, record);
    return record;
  };
  Payment.find = (query) => {
    let resList = Array.from(mockPayments.values());
    if (query && query.order) {
      resList = resList.filter(p => p.order === query.order || (query.order.$in && query.order.$in.includes(p.order)));
    }
    const promise = Promise.resolve(resList);
    promise.sort = async () => resList;
    return promise;
  };

  Refund.findOne = async (query) => {
    if (query.idempotencyKey) {
      return Array.from(mockRefunds.values()).find(r => r.idempotencyKey === query.idempotencyKey) || null;
    }
    return null;
  };
  Refund.create = async (doc) => {
    const record = {
      _id: `ref_${Date.now()}`,
      ...doc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mockRefunds.set(record.revolutRefundOrderId, record);
    return record;
  };
  Refund.find = (query) => {
    let resList = Array.from(mockRefunds.values());
    if (query && query.originalOrder) {
      resList = resList.filter(r => r.originalOrder === query.originalOrder || (query.originalOrder.$in && query.originalOrder.$in.includes(r.originalOrder)));
    }
    const promise = Promise.resolve(resList);
    promise.sort = async () => resList;
    return promise;
  };

  WebhookEvent.create = async (doc) => {
    const record = {
      _id: `evt_${Date.now()}`,
      ...doc,
      createdAt: new Date().toISOString(),
      save: async function() {
        mockWebhookEvents.set(this._id, this);
        return this;
      }
    };
    mockWebhookEvents.set(record._id, record);
    return record;
  };

  const app = express();
  app.use(cors());
  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use('/api/payments', paymentRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/payments`;
  console.log(`✓ Express test server listening on port ${port}\n`);

  try {
    // TEST 1: Create Payment Order
    console.log('--- TEST 1: POST /api/payments/create ---');
    const orderPayload = {
      amount: 4999,
      currency: 'GBP',
      description: 'Order #ORD-10234',
      customer: { email: 'customer@example.com', full_name: 'Jane Doe' },
      line_items: [{ name: 'Wireless Mouse', type: 'physical', quantity: { value: 1 }, unit_price_amount: 4999, total_amount: 4999 }],
      capture_mode: 'automatic',
      merchant_order_data: { reference: 'ORD-10234' }
    };

    let res = await fetch(`${baseUrl}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    let data = await res.json();
    if (res.status !== 201 || !data.id || data.state !== 'pending') throw new Error('TEST 1 FAILED');
    const orderId = data.id;
    console.log('✓ TEST 1 PASSED: Created order ID:', orderId, '\n');

    // TEST 2: Process Payment
    console.log('--- TEST 2: POST /api/payments/process/:orderId ---');
    res = await fetch(`${baseUrl}/process/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardLastFour: '4242', cardBrand: 'visa', cardExpiry: '12/28' })
    });
    data = await res.json();
    if (res.status !== 200 || data.order.state !== 'completed') throw new Error('TEST 2 FAILED');
    console.log('✓ TEST 2 PASSED: Payment processed & order completed\n');

    // TEST 3: Get Payment Status
    console.log('--- TEST 3: GET /api/payments/status/:orderId ---');
    res = await fetch(`${baseUrl}/status/${orderId}`);
    data = await res.json();
    if (res.status !== 200 || data.state !== 'completed') throw new Error('TEST 3 FAILED');
    console.log('✓ TEST 3 PASSED: Retrieved payment status\n');

    // TEST 4: Process Refund & Idempotency
    console.log('--- TEST 4: POST /api/payments/refund/:orderId ---');
    const refundPayload = { amount: 1000, currency: 'GBP', description: 'Partial refund', idempotency_key: 'refund_key_abc123' };
    res = await fetch(`${baseUrl}/refund/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'refund_key_abc123' },
      body: JSON.stringify(refundPayload)
    });
    data = await res.json();
    if (res.status !== 201 || data.type !== 'refund') throw new Error('TEST 4 FAILED');
    console.log('✓ TEST 4 PASSED: Processed partial refund\n');

    // TEST 5: Webhook Listener & Signature Verification (POST /api/payments/webhook)
    console.log('--- TEST 5: POST /api/payments/webhook (Signature Verification & Handler) ---');
    const secret = process.env.REVOLUT_SIGNING_SECRET || 'whsec_test_secret_key_123456789';
    const timestamp = Date.now().toString();
    const webhookBodyStr = JSON.stringify({
      event: 'ORDER_COMPLETED',
      id: 'evt_123456',
      order: { id: orderId, state: 'completed' }
    });

    const payloadToSign = `v1.${timestamp}.${webhookBodyStr}`;
    const signature = 'v1=' + crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

    // Test with valid HMAC signature
    res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Revolut-Request-Timestamp': timestamp,
        'Revolut-Signature': signature
      },
      body: webhookBodyStr
    });
    data = await res.json();
    console.log('Webhook Response Status:', res.status);
    console.log('Webhook Response:', data);

    if (res.status !== 200 || data.status !== 'success') {
      throw new Error('TEST 5 FAILED: Webhook rejected valid signature');
    }

    // Test with invalid signature -> 401
    res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Revolut-Request-Timestamp': timestamp,
        'Revolut-Signature': 'v1=invalid_fake_signature'
      },
      body: webhookBodyStr
    });
    console.log('Invalid Signature Response Status:', res.status);
    if (res.status !== 401) {
      throw new Error('TEST 5 FAILED: Expected 401 for invalid signature');
    }
    console.log('✓ TEST 5 PASSED: Webhook signature verification and handler working properly\n');

    // TEST 6: Get Payment History
    console.log('--- TEST 6: GET /api/payments/history ---');
    res = await fetch(`${baseUrl}/history`);
    data = await res.json();
    if (res.status !== 200 || data.data.length === 0) throw new Error('TEST 6 FAILED');
    console.log('✓ TEST 6 PASSED: History returned records\n');

    console.log('===========================================================');
    console.log('🎉 ALL 6 VERIFICATION TEST SUITES PASSED!');
    console.log('===========================================================\n');

  } catch (err) {
    console.error('❌ Verification Error:', err);
  } finally {
    server.close();
  }
}

runVerification();
