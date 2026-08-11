import mongoose from 'mongoose';

const WebhookEventSchema = new mongoose.Schema({
  revolutEventId: {
    type: String,
    index: true
  },
  eventType: {
    type: String,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  rawPayload: {
    type: Object,
    required: true
  },
  signatureValid: {
    type: Boolean,
    required: true
  },
  processed: {
    type: Boolean,
    default: false
  },
  processedAt: {
    type: Date
  }
}, { timestamps: true });

export default mongoose.model('WebhookEvent', WebhookEventSchema);
