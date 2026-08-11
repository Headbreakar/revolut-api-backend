# Revolut Payment Management System Backend API Implementation & Walkthrough

## Summary of Accomplishments

We have designed, built, and empirically verified a payment management system backend using **Node.js**, **Express**, and **MongoDB** (Mongoose), modeled after the Revolut Merchant API.

---

## Implemented API Endpoints

### 1. Create Payment Order
`POST /api/payments/create`
- Accepts amount (minor units), currency (3-letter ISO code), customer details (`email`, `full_name`), line items, capture mode (`automatic`/`manual`), and merchant reference.
- Validates that the sum of `line_items` matches `amount`.
- Upserts customer records and simulates Revolut order creation (`revolutOrderId`, `token`, `checkout_url`).
- Saves Order to MongoDB in `pending` state.

### 2. Process Payment (Simulate Revolut API Call)
`POST /api/payments/process/:orderId`
- Accepts order ID (`revolutOrderId` or internal `reference`).
- Simulates payment gateway processing (card brand, last 4 digits, expiry, 44-char payment fingerprint, authorization code).
- Supports simulating decline reasons (`insufficient_funds`, `invalid_cvv`, etc.).
- PCI Compliant: Saves only display-safe metadata in `Payment` collection.
- Updates `Order` state (`completed`, `authorised`, or `failed`).

### 3. Get Payment Status
`GET /api/payments/status/:orderId`
- Fetches current order state, outstanding/refunded minor amounts, attached payment attempts, and issued refunds.

### 4. Process Refund
`POST /api/payments/refund/:orderId`
- Accepts partial/full refund requests for orders in `completed` state.
- Enforces mandatory `Idempotency-Key` (in header or body) and stores unique idempotency keys at the database level to prevent duplicate refunds.
- Validates remaining refundable balance before issuing a Revolut refund order simulation.

### 5. Get Payment History
`GET /api/payments/history`
- Returns paginated list of order transactions with embedded customer info, latest payment metadata, and payment/refund counts.
- Supports filtering by order state (`state=completed`) and search keywords.

---

## Authentication & Security
- **API Key Middleware** (`x-api-key` or `Authorization: Bearer <key>`): Toggleable via `API_KEY_REQUIRED` environment variable.
- **PCI Compliance**: No raw card numbers or CVVs stored; amounts strictly maintained as minor unit integers to eliminate floating-point rounding bugs.

---

## Automated Empirical Verification Results

Running test suite `test_verification_fast.js`:

```text
=== Starting Payment System API Verification ===

✓ Express test server listening on port 52596

--- TEST 1: POST /api/payments/create ---
Status Code: 201
✓ TEST 1 PASSED: Created order with ID: 5b7eee0f-e2d2-402d-bf61-6d9a95204a9a 

--- TEST 2: POST /api/payments/process/:orderId ---
Status Code: 200
✓ TEST 2 PASSED: Payment processed and order completed

--- TEST 3: GET /api/payments/status/:orderId ---
Status Code: 200
Response state: completed
Payments attached: 1
✓ TEST 3 PASSED: Retrieved payment status correctly

--- TEST 4: POST /api/payments/refund/:orderId ---
Status Code: 201
✓ TEST 4 PASSED: Processed partial refund

--- TEST 4b: Idempotent Refund Retry ---
Status Code: 200
Idempotent Message: Refund request already processed (idempotent response)
✓ TEST 4b PASSED: Idempotency check worked as expected

--- TEST 5: GET /api/payments/history ---
Status Code: 200
Total Orders in History: 1
✓ TEST 5 PASSED: Payment history returned expected records

--- TEST 6: API Key Authentication Enforcement ---
Unauthenticated Request Status: 401
Authenticated Request Status: 200
✓ TEST 6 PASSED: API Key authentication successfully enforced

=====================================================
🎉 ALL 6 TEST SUITES PASSED! Empirically Verified!
=====================================================
```
