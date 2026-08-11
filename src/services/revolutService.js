import { v4 as uuidv4 } from 'uuid';

class RevolutService {
  createOrder(orderData) {
    const revolutOrderId = uuidv4();
    const token = `ord_tok_${uuidv4().replace(/-/g, '')}`;
    const checkoutUrl = `https://checkout.revolut.com/pay/${revolutOrderId}`;

    return {
      id: revolutOrderId,
      token,
      state: 'pending',
      amount: orderData.amountMinor,
      currency: orderData.currency,
      outstanding_amount: orderData.amountMinor,
      checkout_url: checkoutUrl,
      created_at: new Date().toISOString()
    };
  }

  processPayment(paymentDetails) {
    const revolutPaymentId = uuidv4();
    const { simulateDecline, declineReason, paymentMethodType = 'card', amount, currency } = paymentDetails;

    if (simulateDecline) {
      return {
        id: revolutPaymentId,
        state: 'declined',
        decline_reason: declineReason || 'insufficient_funds',
        bank_message: 'Transaction declined by card issuer',
        amount,
        currency,
        payment_method: {
          type: paymentMethodType,
          card_last_four: paymentDetails.cardLastFour || '4242',
          card_brand: paymentDetails.cardBrand || 'visa',
          card_expiry: paymentDetails.cardExpiry || '12/28',
          fingerprint: `fp_${uuidv4().substring(0, 40)}`
        },
        created_at: new Date().toISOString()
      };
    }

    return {
      id: revolutPaymentId,
      state: 'completed',
      amount,
      currency,
      payment_method: {
        type: paymentMethodType,
        card_last_four: paymentDetails.cardLastFour || '4242',
        card_brand: paymentDetails.cardBrand || 'visa',
        card_expiry: paymentDetails.cardExpiry || '12/28',
        fingerprint: `fp_${uuidv4().substring(0, 40)}`
      },
      authorisation_code: Math.floor(100000 + Math.random() * 900000).toString(),
      network_transaction_id: `nt_${uuidv4().substring(0, 30)}`,
      created_at: new Date().toISOString()
    };
  }

  processRefund(refundData) {
    const revolutRefundOrderId = uuidv4();

    return {
      id: revolutRefundOrderId,
      type: 'refund',
      related_order_id: refundData.revolutOrderId,
      state: 'completed',
      amount: refundData.amountMinor,
      currency: refundData.currency,
      description: refundData.description || 'Refund for order',
      created_at: new Date().toISOString()
    };
  }
}

export default new RevolutService();
