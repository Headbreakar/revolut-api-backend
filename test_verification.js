const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const cors = require('cors');
const paymentRoutes = require('./src/routes/paymentRoutes');
const errorHandler = require('./src/middleware/errorHandler');
const Order = require('./src/models/Order');

async function runVerification() {
  console.log('=== Starting Payment System API Verification ===\n');

  // 1. Start MongoDB In-Memory Server
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  console.log('✓ Connected to In-Memory MongoDB');

  // 2. Setup Express App
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  app.use(errorHandler);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/payments`;
  console.log(`✓ Express test server listening on port ${port}\n`);

  try {
    // TEST 1: Create Payment Order (POST /api/payments/create)
    console.log('--- TEST 1: POST /api/payments/create ---');
    const orderPayload = {
      amount: 4999, // £49.99 in minor units
      currency: 'GBP',
      description: 'Order #ORD-10234',
      customer: {
        email: 'customer@example.com',
        full_name: 'Jane Doe'
      },
      line_items: [
        {
          name: 'Wireless Mouse',
          type: 'physical',
          quantity: { value: 1 },
          unit_price_amount: 4999,
          total_amount: 4999
        }
      ],
      capture_mode: 'automatic',
      merchant_order_data: {
        reference: 'ORD-10234'
      }
    };

    let res = await fetch(`${baseUrl}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    let data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (res.status !== 201 || !data.id || data.state !== 'pending') {
      throw new Error('TEST 1 FAILED');
    }
    const orderId = data.id;
    console.log('✓ TEST 1 PASSED: Created order with ID:', orderId, '\n');

    // TEST 2: Process Payment (POST /api/payments/process/:orderId)
    console.log('--- TEST 2: POST /api/payments/process/:orderId ---');
    res = await fetch(`${baseUrl}/process/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardLastFour: '4242',
        cardBrand: 'visa',
        cardExpiry: '12/28'
      })
    });
    data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (res.status !== 200 || data.order.state !== 'completed') {
      throw new Error('TEST 2 FAILED');
    }
    console.log('✓ TEST 2 PASSED: Payment processed and order completed\n');

    // TEST 3: Get Payment Status (GET /api/payments/status/:orderId)
    console.log('--- TEST 3: GET /api/payments/status/:orderId ---');
    res = await fetch(`${baseUrl}/status/${orderId}`);
    data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response state:', data.state);
    console.log('Payments attached:', data.payments.length);

    if (res.status !== 200 || data.state !== 'completed' || data.payments.length === 0) {
      throw new Error('TEST 3 FAILED');
    }
    console.log('✓ TEST 3 PASSED: Retrieved payment status correctly\n');

    // TEST 4: Process Refund (POST /api/payments/refund/:orderId)
    console.log('--- TEST 4: POST /api/payments/refund/:orderId ---');
    const refundPayload = {
      amount: 1000, // Partial refund of £10.00
      currency: 'GBP',
      description: 'Partial refund for item',
      idempotency_key: 'refund_key_abc123'
    };
    res = await fetch(`${baseUrl}/refund/${orderId}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Idempotency-Key': 'refund_key_abc123'
      },
      body: JSON.stringify(refundPayload)
    });
    data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (res.status !== 201 || data.amount !== 1000 || data.type !== 'refund') {
      throw new Error('TEST 4 FAILED');
    }
    console.log('✓ TEST 4 PASSED: Processed partial refund\n');

    // TEST 4b: Test Refund Idempotency
    console.log('--- TEST 4b: Idempotent Refund Retry ---');
    res = await fetch(`${baseUrl}/refund/${orderId}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Idempotency-Key': 'refund_key_abc123'
      },
      body: JSON.stringify(refundPayload)
    });
    data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Idempotent Message:', data.message);

    if (res.status !== 200 || !data.message.includes('idempotent')) {
      throw new Error('TEST 4b FAILED');
    }
    console.log('✓ TEST 4b PASSED: Idempotency check worked as expected\n');

    // TEST 5: Get Payment History (GET /api/payments/history)
    console.log('--- TEST 5: GET /api/payments/history ---');
    res = await fetch(`${baseUrl}/history`);
    data = await res.json();
    console.log('Status Code:', res.status);
    console.log('Total Orders in History:', data.pagination.total);
    console.log('First Record Reference:', data.data[0]?.reference);

    if (res.status !== 200 || data.data.length === 0) {
      throw new Error('TEST 5 FAILED');
    }
    console.log('✓ TEST 5 PASSED: Payment history returned expected records\n');

    // TEST 6: API Key Authentication Enforcement Test
    console.log('--- TEST 6: API Key Authentication Enforcement ---');
    process.env.API_KEY_REQUIRED = 'true';
    process.env.API_KEY = 'secret_test_key_999';

    // Without API key -> 401
    res = await fetch(`${baseUrl}/history`);
    console.log('Unauthenticated Request Status:', res.status);
    if (res.status !== 401) {
      throw new Error('TEST 6 FAILED: Expected 401 Unauthorized without key');
    }

    // With valid API key header -> 200
    res = await fetch(`${baseUrl}/history`, {
      headers: { 'x-api-key': 'secret_test_key_999' }
    });
    console.log('Authenticated Request Status:', res.status);
    if (res.status !== 200) {
      throw new Error('TEST 6 FAILED: Expected 200 OK with valid x-api-key');
    }
    console.log('✓ TEST 6 PASSED: API Key authentication successfully enforced\n');

    console.log('=====================================================');
    console.log('🎉 ALL 6 TEST SUITES PASSEDEmpirically Verified!');
    console.log('=====================================================\n');

  } catch (err) {
    console.error('❌ Verification Error:', err);
  } finally {
    server.close();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

runVerification();
