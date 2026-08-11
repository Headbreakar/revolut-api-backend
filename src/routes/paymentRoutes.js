import express from 'express';
import { authenticateApiKey, verifyWebhookSignature } from '../middleware/auth.js';
import {
  createPaymentOrder,
  processPayment,
  getPaymentStatus,
  processRefund,
  getPaymentHistory,
  handleWebhook
} from '../controllers/paymentController.js';

const router = express.Router();

// Webhook listener endpoint with signature verification middleware
router.post('/webhook', verifyWebhookSignature, handleWebhook);

// All regular payment management routes use API key authentication middleware
router.post('/create', authenticateApiKey, createPaymentOrder);
router.post('/process/:orderId', authenticateApiKey, processPayment);
router.get('/status/:orderId', authenticateApiKey, getPaymentStatus);
router.post('/refund/:orderId', authenticateApiKey, processRefund);
router.get('/history', authenticateApiKey, getPaymentHistory);

export default router;
