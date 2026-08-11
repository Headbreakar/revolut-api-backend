import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Refund from '../models/Refund.js';
import Customer from '../models/Customer.js';
import WebhookEvent from '../models/WebhookEvent.js';
import revolutService from '../services/revolutService.js';

export const createPaymentOrder = async (req, res, next) => {
  try {
    const {
      amount,
      currency,
      description,
      customer,
      line_items,
      capture_mode = 'automatic',
      merchant_order_data,
      expire_pending_after = 'PT30M'
    } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'amount is required and must be a positive integer in minor units'
      });
    }

    if (!currency || typeof currency !== 'string' || currency.length !== 3) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'currency is required and must be a 3-letter ISO code'
      });
    }

    if (!customer || !customer.email || !customer.full_name) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'customer details (email and full_name) are required'
      });
    }

    const reference = merchant_order_data?.reference || `ORD-${Date.now()}`;

    const existingOrder = await Order.findOne({ reference });
    if (existingOrder) {
      return res.status(400).json({
        error: 'DuplicateReference',
        message: `Order with reference ${reference} already exists`
      });
    }

    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      const lineItemsSum = line_items.reduce((sum, item) => sum + (item.total_amount || 0), 0);
      if (lineItemsSum !== amount) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `The sum of line items total_amount (${lineItemsSum}) must equal the order total amount (${amount})`
        });
      }
    }

    await Customer.findOneAndUpdate(
      { email: customer.email },
      { fullName: customer.full_name },
      { upsert: true, returnDocument: 'after' }
    );

    const revolutResp = revolutService.createOrder({
      amountMinor: amount,
      currency: currency.toUpperCase(),
      description
    });

    const formattedLineItems = (line_items || []).map(item => ({
      name: item.name,
      type: item.type || 'physical',
      quantity: { value: item.quantity?.value || 1 },
      unitPriceAmount: item.unit_price_amount,
      totalAmount: item.total_amount
    }));

    const newOrder = await Order.create({
      reference,
      revolutOrderId: revolutResp.id,
      token: revolutResp.token,
      customer: {
        email: customer.email,
        fullName: customer.full_name
      },
      amountMinor: amount,
      currency: currency.toUpperCase(),
      state: 'pending',
      captureMode: capture_mode,
      outstandingAmountMinor: amount,
      refundedAmountMinor: 0,
      checkoutUrl: revolutResp.checkout_url,
      lineItems: formattedLineItems,
      expirePendingAfter: expire_pending_after
    });

    res.status(201).json({
      id: newOrder.revolutOrderId,
      token: newOrder.token,
      state: newOrder.state,
      amount: newOrder.amountMinor,
      currency: newOrder.currency,
      outstanding_amount: newOrder.outstandingAmountMinor,
      checkout_url: newOrder.checkoutUrl,
      merchant_order_data: {
        reference: newOrder.reference
      },
      created_at: newOrder.createdAt
    });
  } catch (error) {
    next(error);
  }
};

export const processPayment = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const {
      cardLastFour = '4242',
      cardBrand = 'visa',
      cardExpiry = '12/28',
      paymentMethodType = 'card',
      simulateDecline = false,
      declineReason = 'insufficient_funds'
    } = req.body;

    const order = await Order.findOne({
      $or: [{ revolutOrderId: orderId }, { reference: orderId }]
    });

    if (!order) {
      return res.status(404).json({
        error: 'NotFound',
        message: `Order ${orderId} not found`
      });
    }

    if (order.state === 'completed') {
      return res.status(400).json({
        error: 'InvalidOrderState',
        message: 'Order has already been completed'
      });
    }

    if (order.state === 'cancelled' || order.state === 'failed') {
      return res.status(400).json({
        error: 'InvalidOrderState',
        message: `Cannot process payment for an order in state: ${order.state}`
      });
    }

    order.state = 'processing';
    await order.save();

    const revPayment = revolutService.processPayment({
      simulateDecline,
      declineReason,
      paymentMethodType,
      amount: order.amountMinor,
      currency: order.currency,
      cardLastFour,
      cardBrand,
      cardExpiry
    });

    const paymentRecord = await Payment.create({
      order: order._id,
      revolutPaymentId: revPayment.id,
      state: revPayment.state,
      declineReason: revPayment.decline_reason,
      bankMessage: revPayment.bank_message,
      amountMinor: revPayment.amount,
      currency: revPayment.currency,
      paymentMethodType: revPayment.payment_method.type,
      cardBrand: revPayment.payment_method.card_brand,
      cardLastFour: revPayment.payment_method.card_last_four,
      cardExpiry: revPayment.payment_method.card_expiry,
      paymentFingerprint: revPayment.payment_method.fingerprint,
      authorisationCode: revPayment.authorisation_code,
      networkTransactionId: revPayment.network_transaction_id
    });

    if (revPayment.state === 'completed') {
      order.state = order.captureMode === 'manual' ? 'authorised' : 'completed';
      if (order.state === 'completed') {
        order.outstandingAmountMinor = 0;
      }
    } else if (revPayment.state === 'declined') {
      order.state = 'failed';
    }
    await order.save();

    res.status(200).json({
      message: revPayment.state === 'completed' ? 'Payment processed successfully' : 'Payment declined',
      order: {
        id: order.revolutOrderId,
        reference: order.reference,
        state: order.state,
        amount: order.amountMinor,
        currency: order.currency
      },
      payment: {
        id: paymentRecord.revolutPaymentId,
        state: paymentRecord.state,
        decline_reason: paymentRecord.declineReason,
        bank_message: paymentRecord.bankMessage,
        payment_method: {
          type: paymentRecord.paymentMethodType,
          card_brand: paymentRecord.cardBrand,
          card_last_four: paymentRecord.cardLastFour,
          card_expiry: paymentRecord.cardExpiry,
          fingerprint: paymentRecord.paymentFingerprint
        },
        authorisation_code: paymentRecord.authorisationCode,
        created_at: paymentRecord.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      $or: [{ revolutOrderId: orderId }, { reference: orderId }]
    });

    if (!order) {
      return res.status(404).json({
        error: 'NotFound',
        message: `Order ${orderId} not found`
      });
    }

    const payments = await Payment.find({ order: order._id }).sort({ createdAt: -1 });
    const refunds = await Refund.find({ originalOrder: order._id }).sort({ createdAt: -1 });

    res.status(200).json({
      id: order.revolutOrderId,
      reference: order.reference,
      state: order.state,
      amount: order.amountMinor,
      currency: order.currency,
      outstanding_amount: order.outstandingAmountMinor,
      refunded_amount: order.refundedAmountMinor,
      customer: order.customer,
      checkout_url: order.checkoutUrl,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      payments: payments.map(p => ({
        id: p.revolutPaymentId,
        state: p.state,
        decline_reason: p.declineReason,
        bank_message: p.bankMessage,
        amount: p.amountMinor,
        currency: p.currency,
        payment_method: {
          type: p.paymentMethodType,
          card_brand: p.cardBrand,
          card_last_four: p.cardLastFour,
          card_expiry: p.cardExpiry,
          fingerprint: p.paymentFingerprint
        },
        authorisation_code: p.authorisationCode,
        created_at: p.createdAt
      })),
      refunds: refunds.map(r => ({
        id: r.revolutRefundOrderId,
        amount: r.amountMinor,
        currency: r.currency,
        state: r.state,
        description: r.description,
        idempotency_key: r.idempotencyKey,
        created_at: r.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const processRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { amount, currency, description } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key;

    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Idempotency-Key header or idempotency_key body parameter is required for refund requests'
      });
    }

    const existingRefund = await Refund.findOne({ idempotencyKey });
    if (existingRefund) {
      return res.status(200).json({
        message: 'Refund request already processed (idempotent response)',
        refund: {
          id: existingRefund.revolutRefundOrderId,
          amount: existingRefund.amountMinor,
          currency: existingRefund.currency,
          state: existingRefund.state,
          description: existingRefund.description,
          idempotency_key: existingRefund.idempotencyKey,
          created_at: existingRefund.createdAt
        }
      });
    }

    const order = await Order.findOne({
      $or: [{ revolutOrderId: orderId }, { reference: orderId }]
    });

    if (!order) {
      return res.status(404).json({
        error: 'NotFound',
        message: `Order ${orderId} not found`
      });
    }

    if (order.state !== 'completed') {
      return res.status(400).json({
        error: 'InvalidOrderState',
        message: `Refunds are only allowed on orders in 'completed' state. Current state: '${order.state}'`
      });
    }

    const refundAmount = amount || order.amountMinor;
    if (refundAmount <= 0 || !Number.isInteger(refundAmount)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Refund amount must be a positive integer in minor units'
      });
    }

    if (currency && currency.toUpperCase() !== order.currency) {
      return res.status(400).json({
        error: 'ValidationError',
        message: `Refund currency (${currency}) must match order currency (${order.currency})`
      });
    }

    const maxRefundable = order.amountMinor - (order.refundedAmountMinor || 0);
    if (refundAmount > maxRefundable) {
      return res.status(400).json({
        error: 'RefundAmountExceeded',
        message: `Requested refund amount (${refundAmount}) exceeds maximum refundable amount (${maxRefundable})`
      });
    }

    const revRefund = revolutService.processRefund({
      revolutOrderId: order.revolutOrderId,
      amountMinor: refundAmount,
      currency: order.currency,
      description
    });

    const newRefund = await Refund.create({
      originalOrder: order._id,
      revolutRefundOrderId: revRefund.id,
      amountMinor: refundAmount,
      currency: order.currency,
      state: 'completed',
      description: description || `Refund for order ${order.reference}`,
      idempotencyKey
    });

    order.refundedAmountMinor += refundAmount;
    await order.save();

    res.status(201).json({
      id: newRefund.revolutRefundOrderId,
      type: 'refund',
      related_order_id: order.revolutOrderId,
      amount: newRefund.amountMinor,
      currency: newRefund.currency,
      state: newRefund.state,
      description: newRefund.description,
      idempotency_key: newRefund.idempotencyKey,
      created_at: newRefund.createdAt
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentHistory = async (req, res, next) => {
  try {
    const { state, page = 1, limit = 10, search } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (state) {
      query.state = state;
    }
    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { revolutOrderId: { $regex: search, $options: 'i' } },
        { 'customer.email': { $regex: search, $options: 'i' } },
        { 'customer.fullName': { $regex: search, $options: 'i' } }
      ];
    }

    const totalOrders = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const orderIds = orders.map(o => o._id);
    const payments = await Payment.find({ order: { $in: orderIds } });
    const refunds = await Refund.find({ originalOrder: { $in: orderIds } });

    const historyItems = orders.map(order => {
      const orderPayments = payments.filter(p => p.order.toString() === order._id.toString());
      const orderRefunds = refunds.filter(r => r.originalOrder.toString() === order._id.toString());

      return {
        id: order.revolutOrderId,
        reference: order.reference,
        customer: order.customer,
        amount: order.amountMinor,
        currency: order.currency,
        state: order.state,
        refunded_amount: order.refundedAmountMinor,
        checkout_url: order.checkoutUrl,
        created_at: order.createdAt,
        payments_count: orderPayments.length,
        refunds_count: orderRefunds.length,
        latest_payment: orderPayments.length > 0 ? {
          id: orderPayments[orderPayments.length - 1].revolutPaymentId,
          state: orderPayments[orderPayments.length - 1].state,
          card_last_four: orderPayments[orderPayments.length - 1].cardLastFour,
          card_brand: orderPayments[orderPayments.length - 1].cardBrand
        } : null
      };
    });

    res.status(200).json({
      data: historyItems,
      pagination: {
        total: totalOrders,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalOrders / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Webhook Listener
 * POST /api/payments/webhook
 */
export const handleWebhook = async (req, res, next) => {
  try {
    const payload = req.body;
    const eventType = payload.event;
    const revolutEventId = payload.id || `evt_${Date.now()}`;
    const orderData = payload.order || payload.data;

    // Find linked order if order ID provided
    let linkedOrder = null;
    if (orderData && orderData.id) {
      linkedOrder = await Order.findOne({ revolutOrderId: orderData.id });
    }

    // Record webhook event in audit log (deduplicated)
    const webhookRecord = await WebhookEvent.create({
      revolutEventId,
      eventType,
      order: linkedOrder ? linkedOrder._id : null,
      rawPayload: payload,
      signatureValid: req.isSignatureValid ?? true,
      processed: false
    });

    // Asynchronously handle business logic based on event type
    if (linkedOrder && orderData) {
      if (eventType === 'ORDER_COMPLETED') {
        linkedOrder.state = 'completed';
        linkedOrder.outstandingAmountMinor = 0;
        await linkedOrder.save();
      } else if (eventType === 'ORDER_AUTHORISED') {
        linkedOrder.state = 'authorised';
        await linkedOrder.save();
      } else if (eventType === 'ORDER_PAYMENT_FAILED') {
        linkedOrder.state = 'failed';
        await linkedOrder.save();
      }
    }

    webhookRecord.processed = true;
    webhookRecord.processedAt = new Date();
    await webhookRecord.save();

    res.status(200).json({ status: 'success', event_id: revolutEventId });
  } catch (error) {
    next(error);
  }
};
