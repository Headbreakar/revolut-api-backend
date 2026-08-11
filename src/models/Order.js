import mongoose from 'mongoose';

const LineItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, default: 'physical' },
  quantity: { value: { type: Number, required: true } },
  unitPriceAmount: { type: Number, required: true }, // minor units
  totalAmount: { type: Number, required: true } // minor units
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  revolutOrderId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  token: {
    type: String,
    required: true
  },
  customer: {
    email: { type: String, required: true },
    fullName: { type: String, required: true }
  },
  amountMinor: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    length: 3
  },
  state: {
    type: String,
    enum: ['pending', 'processing', 'authorised', 'completed', 'cancelled', 'failed'],
    default: 'pending',
    index: true
  },
  captureMode: {
    type: String,
    enum: ['automatic', 'manual'],
    default: 'automatic'
  },
  outstandingAmountMinor: {
    type: Number,
    required: true
  },
  refundedAmountMinor: {
    type: Number,
    default: 0
  },
  checkoutUrl: {
    type: String
  },
  lineItems: [LineItemSchema],
  expirePendingAfter: {
    type: String,
    default: 'PT30M'
  }
}, { timestamps: true });

export default mongoose.model('Order', OrderSchema);
