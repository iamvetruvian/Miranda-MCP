import express from 'express';
const router = express.Router();
import {
  addOrderItems,
  getMyOrders,
  getOrderById,
  createStripePaymentLinkForOrder,
  updateOrderToPaid,
  updateOrderToDelivered,
  getOrders,
  renderStripeCheckoutPage,
} from '../controllers/orderController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.route('/').post(protect, addOrderItems).get(protect, admin, getOrders);
router.route('/mine').get(protect, getMyOrders);
router.route('/:id').get(protect, getOrderById);
router.route('/:id/pay-link').post(protect, createStripePaymentLinkForOrder);
router.route('/:id/pay').get(renderStripeCheckoutPage).put(updateOrderToPaid);
router.route('/:id/deliver').put(protect, admin, updateOrderToDelivered);

export default router;
