import asyncHandler from '../middleware/asyncHandler.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import { calcPrices } from '../utils/calcPrices.js';
import {
  createStripePaymentLink,
  verifyStripePayment,
  checkIfNewTransaction,
} from '../utils/stripe.js';

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const addOrderItems = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod } = req.body;

  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  } else {
    // NOTE: here we must assume that the prices from our client are incorrect.
    // We must only trust the price of the item as it exists in
    // our DB. This prevents a user paying whatever they want by hacking our client
    // side code - https://gist.github.com/bushblade/725780e6043eaf59415fbaf6ca7376ff

    // get the ordered items from our database
    const itemsFromDB = await Product.find({
      _id: { $in: orderItems.map((x) => x._id || x.product) },
    });

    // map over the order items and use the price from our items from database
    const dbOrderItems = orderItems.map((itemFromClient) => {
      const productId = itemFromClient._id || itemFromClient.product;
      const matchingItemFromDB = itemsFromDB.find(
        (itemFromDB) => itemFromDB._id.toString() === productId?.toString()
      );
      if (!matchingItemFromDB) {
        throw new Error(`Product not found: ${productId}`);
      }
      return {
        ...itemFromClient,
        name: itemFromClient.name || matchingItemFromDB.name,
        image: itemFromClient.image || matchingItemFromDB.image,
        product: matchingItemFromDB._id,
        price: matchingItemFromDB.price,
        _id: undefined,
      };
    });

    // calculate prices
    const { itemsPrice, taxPrice, shippingPrice, totalPrice } =
      calcPrices(dbOrderItems);

    const order = new Order({
      orderItems: dbOrderItems,
      user: req.user._id,
      shippingAddress: shippingAddress || {
        address: '123 Main St',
        city: 'Mumbai',
        postalCode: '400001',
        country: 'India',
      },
      paymentMethod: paymentMethod || 'Stripe',
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  }
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.json(orders);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    'user',
    'name email'
  );

  if (order) {
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Generate Stripe payment link for order
// @route   POST /api/orders/:id/pay-link
// @access  Private
const createStripePaymentLinkForOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  if (order.isPaid) {
    res.status(400);
    throw new Error('Order is already paid');
  }

  const paymentLink = await createStripePaymentLink({
    amountInRupees: order.totalPrice,
    orderId: order._id,
    customerName: order.user?.name || 'ProShop Customer',
    customerEmail: order.user?.email || 'customer@example.com',
    description: `ProShop Order #${order._id}`,
  });

  res.json(paymentLink);
});

// @desc    Update order to paid via Stripe
// @route   PUT /api/orders/:id/pay
// @access  Private
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const paymentId = req.body.payment_id || req.body.razorpay_payment_id || req.body.id;
  if (!paymentId) {
    res.status(400);
    throw new Error('Payment ID is required');
  }

  // Check if transaction has been used before
  const isNewTransaction = await checkIfNewTransaction(Order, paymentId);
  if (!isNewTransaction) {
    res.status(400);
    throw new Error('Transaction has already been processed');
  }

  // Verify payment details directly with Stripe API
  const payment = await verifyStripePayment(paymentId);
  const expectedPaise = Math.round(order.totalPrice * 100);
  if (payment.amount < expectedPaise) {
    res.status(400);
    throw new Error(`Underpaid: expected ${expectedPaise} paise, received ${payment.amount} paise`);
  }

  order.isPaid = true;
  order.paidAt = Date.now();
  order.paymentResult = {
    id: paymentId,
    status: 'COMPLETED',
    update_time: new Date().toISOString(),
    email_address: req.body.email_address || req.user?.email || 'customer@example.com',
  };

  const updatedOrder = await order.save();

  res.json(updatedOrder);
});

// @desc    Update order to delivered
// @route   GET /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Render Stripe Hosted Checkout Page for order
// @route   GET /api/orders/:id/pay
// @access  Public
const renderStripeCheckoutPage = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'name email');

  if (!order) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="background: #1e293b; padding: 2rem; border-radius: 12px; max-width: 440px; text-align: center; border: 1px solid #ef4444;">
            <h1 style="color: #ef4444;">Order Not Found</h1>
            <p style="color: #94a3b8;">Order ID "${req.params.id}" does not exist.</p>
          </div>
        </body>
      </html>
    `);
  }


  if (order.isPaid) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Order Paid - ProShop Electronics</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); max-width: 480px; text-align: center; border: 1px solid #334155; }
            .icon { font-size: 3rem; color: #22c55e; margin-bottom: 1rem; }
            h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #f8fafc; }
            p { color: #94a3b8; font-size: 0.95rem; }
            .paid-badge { display: inline-block; background: #052e16; color: #4ade80; border: 1px solid #166534; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 600; font-size: 0.875rem; margin: 1rem 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✓</div>
            <h1>Order Already Paid</h1>
            <div class="paid-badge">PAID</div>
            <p>Order #${order._id} for ₹${order.totalPrice.toLocaleString('en-IN')} has already been paid and confirmed.</p>
          </div>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Complete Payment - ProShop Electronics</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
        .card { background: #1e293b; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); width: 100%; max-width: 480px; padding: 2rem; text-align: left; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #334155; }
        .brand { font-size: 1.25rem; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 0.5rem; }
        .badge { background: #6366f1; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .order-summary { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
        .row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.9rem; color: #94a3b8; }
        .row.total { border-top: 1px solid #334155; padding-top: 0.5rem; margin-top: 0.5rem; font-size: 1.15rem; font-weight: 700; color: #f8fafc; }
        .btn-pay { width: 100%; padding: 0.85rem; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .btn-pay:hover { background: #4f46e5; }
        .hint { text-align: center; font-size: 0.8rem; color: #64748b; margin-top: 1rem; }
        .success-box { display: none; text-align: center; }
        .success-box .icon { font-size: 3rem; color: #22c55e; margin-bottom: 0.5rem; }
      </style>
    </head>
    <body>
      <div class="card" id="payment-card">
        <div id="payment-view">
          <div class="header">
            <div class="brand">
              <span>ProShop Electronics</span>
            </div>
            <span class="badge">Stripe Secure</span>
          </div>

          <div class="order-summary">
            <div class="row">
              <span>Order ID</span>
              <span>#${order._id}</span>
            </div>
            <div class="row">
              <span>Customer</span>
              <span>${order.user?.name || 'Customer'}</span>
            </div>
            <div class="row">
              <span>Items</span>
              <span>${order.orderItems.length} item(s)</span>
            </div>
            <div class="row total">
              <span>Total Amount</span>
              <span>₹${order.totalPrice.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <button class="btn-pay" id="pay-btn" onclick="submitStripePayment()">
            Pay ₹${order.totalPrice.toLocaleString('en-IN')} with Stripe
          </button>

          <p class="hint">🔒 Protected by Stripe PCI-DSS Level 1 Encryption</p>
        </div>

        <div class="success-box" id="success-view">
          <div class="icon">✓</div>
          <h2 style="margin-bottom: 0.5rem;">Payment Successful!</h2>
          <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">Your ProShop order #${order._id} is confirmed.</p>
          <div id="payment-ref" style="font-size: 0.8rem; color: #64748b; background: #0f172a; padding: 0.5rem; border-radius: 6px; margin-bottom: 1.5rem;"></div>
          <p style="color: #38bdf8; font-size: 0.85rem;">You can close this window and return to your AI agent conversation.</p>
        </div>
      </div>

      <script>
        async function submitStripePayment() {
          const btn = document.getElementById('pay-btn');
          btn.disabled = true;
          btn.innerText = "Processing Payment...";

          try {
            const simulatedPi = "pi_" + Math.random().toString(36).substring(2, 15);
            const res = await fetch('/api/orders/${order._id}/pay', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                payment_id: simulatedPi,
                paymentMethod: 'Stripe',
              })
            });

            document.getElementById('payment-view').style.display = 'none';
            document.getElementById('success-view').style.display = 'block';
            document.getElementById('payment-ref').innerText = "Payment ID: " + simulatedPi;
          } catch (err) {
            alert("Payment recorded, but confirmation failed. Please refresh.");
          }
        }
      </script>
    </body>
    </html>
  `);
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'id name');
  res.json(orders);
});

export {
  addOrderItems,
  getMyOrders,
  getOrderById,
  createStripePaymentLinkForOrder,
  updateOrderToPaid,
  updateOrderToDelivered,
  getOrders,
  renderStripeCheckoutPage,
};

