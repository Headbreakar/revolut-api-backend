import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  revolutPaymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  state: {
    type: String,
    enum: ['pending', 'processing', 'authorisation_passed', 'completed', 'declined', 'failed'],
    required: true
  },
  declineReason: {
    type: String
  },
  bankMessage: {
    type: String
  },
  amountMinor: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    uppercase: true
  },
  paymentMethodType: {
    type: String,
    enum: ['card', 'apple_pay', 'google_pay', 'revolut_pay_card', 'revolut_pay_account', 'sepa_direct_debit'],
    default: 'card'
  },
  cardBrand: {
    type: String
  },
  cardLastFour: {
    type: String,
    length: 4
  },
  cardExpiry: {
    type: String
  },
  paymentFingerprint: {
    type: String,
    index: true
  },
  authorisationCode: {
    type: String
  },
  networkTransactionId: {
    type: String
  }
}, { timestamps: true });

export default mongoose.model('Payment', PaymentSchema);
