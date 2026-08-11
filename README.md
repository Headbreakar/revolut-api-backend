# Revolut Payment Management System - API Testing Guide

This guide details how to test all 5 payment management endpoints plus the webhook listener using **Postman**, **cURL**, or automated scripts.

---

## Step 1: Start the API Server

Before testing in Postman or cURL, make sure MongoDB is running and start your Express server:

```bash
node server.js
```

_Expected output:_

```text
MongoDB Connected: 127.0.0.1
Payment API Server running on port 3000
```

Base URL for all requests: `http://localhost:3000`

---

## Step 2: Postman Setup & Test Cases

You can test in **Postman** by creating requests for each endpoint below.

---

### Request 1: Create a Payment Order

- **Method**: `POST`
- **URL**: `http://localhost:3000/api/payments/create`
- **Headers**:
  - `Content-Type`: `application/json`
  - _(Optional if API key enabled)_ `x-api-key`: `revolut_secret_api_key_12345`
- **Body** (`raw` -> `JSON`):

```json
{
  "amount": 4999,
  "currency": "GBP",
  "description": "Order #ORD-10234",
  "customer": {
    "email": "customer@example.com",
    "full_name": "Jane Doe"
  },
  "line_items": [
    {
      "name": "Wireless Mouse",
      "type": "physical",
      "quantity": { "value": 1 },
      "unit_price_amount": 4999,
      "total_amount": 4999
    }
  ],
  "capture_mode": "automatic",
  "merchant_order_data": {
    "reference": "ORD-10234"
  }
}
```

- **Expected Response (201 Created)**:
  - Copy the returned `"id"` (e.g. `550e8400-e29b-41d4-a716-446655440000`) for the next requests!

---

### Request 2: Process Payment (Simulate Revolut Gateway)

- **Method**: `POST`
- **URL**: `http://localhost:3000/api/payments/process/:orderId`  
  _(Replace `:orderId` with Revolut ID or internal reference, e.g. `http://localhost:3000/api/payments/process/ORD-10234`)_
- **Headers**:
  - `Content-Type`: `application/json`
- **Body** (`raw` -> `JSON`):

```json
{
  "cardLastFour": "4242",
  "cardBrand": "visa",
  "cardExpiry": "12/28",
  "paymentMethodType": "card",
  "simulateDecline": false
}
```

- **Expected Response (200 OK)**:
  - Order state moves to `"completed"`, payment method metadata is recorded.

---

### Request 3: Get Payment Status

- **Method**: `GET`
- **URL**: `http://localhost:3000/api/payments/status/ORD-10234`
- **Headers**: None required.
- **Expected Response (200 OK)**:
  - Returns complete order object, payment history array, and refund array.

---

### Request 4: Process Partial or Full Refund

- **Method**: `POST`
- **URL**: `http://localhost:3000/api/payments/refund/ORD-10234`
- **Headers**:
  - `Content-Type`: `application/json`
  - `Idempotency-Key`: `refund_req_unique_999`
- **Body** (`raw` -> `JSON`):

```json
{
  "amount": 1000,
  "currency": "GBP",
  "description": "Partial refund for customer"
}
```

- **Expected Response (201 Created)**:
  - Returns refund object, updates `refunded_amount` in DB.
  - _Retry Test_: If you press **Send** again with the same `Idempotency-Key`, you get a `200 OK` idempotent response without double-refunding.

---

### Request 5: Get Payment History

- **Method**: `GET`
- **URL**: `http://localhost:3000/api/payments/history?page=1&limit=10`
- **Expected Response (200 OK)**:
  - Returns paginated order transaction history.

---

### Request 6: Test Webhook Listener (Optional)

- **Method**: `POST`
- **URL**: `http://localhost:3000/api/payments/webhook`
- **Headers**:
  - `Content-Type`: `application/json`
  - `Revolut-Request-Timestamp`: `1770768000000` _(current timestamp in ms)_
  - `Revolut-Signature`: _(HMAC SHA-256 signature calculated from payload)_

---

## Alternative Testing Methods

### Method B: Testing with cURL commands in Terminal

If you prefer testing directly in your terminal, run these commands:

```bash
# 1. Create Order
curl -X POST http://localhost:3000/api/payments/create \
  -H "Content-Type: application/json" \
  -d '{"amount":4999,"currency":"GBP","customer":{"email":"jane@example.com","full_name":"Jane Doe"}}'

# 2. Process Payment
curl -X POST http://localhost:3000/api/payments/process/ORD-10234 \
  -H "Content-Type: application/json" \
  -d '{"cardLastFour":"4242","cardBrand":"visa"}'

# 3. Get Status
curl http://localhost:3000/api/payments/status/ORD-10234

# 4. Process Refund
curl -X POST http://localhost:3000/api/payments/refund/ORD-10234 \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ref_key_101" \
  -d '{"amount":1000}'

# 5. History
curl http://localhost:3000/api/payments/history
```

### Method C: One-Click Automated DB Test Script

You can also run our included integration test script that tests all endpoints against your local MongoDB automatically:

```bash
node test_verification_db.js
```
