import mongoose from 'mongoose';

const RefundSchema = new mongoose.Schema({
  originalOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },
  revolutRefundOrderId: {
    type: String,
    required: true,
    unique: true
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
  state: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'completed'
  },
  description: {
    type: String
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  }
}, { timestamps: true });

export default mongoose.model('Refund', RefundSchema);
