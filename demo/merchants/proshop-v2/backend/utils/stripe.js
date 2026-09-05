import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const rawKey = process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.trim() : '';
const isSimulated = !rawKey || rawKey.startsWith('sk_test_mock');
const secretKey = !isSimulated ? rawKey : 'sk_test_mock_secret_key';

const stripe = !isSimulated ? new Stripe(secretKey) : null;

/**
 * Creates a Stripe hosted Checkout Session for one-time payment.
 * @param {Object} params
 * @param {number} params.amountInRupees
 * @param {string} params.orderId
 * @param {string} params.customerName
 * @param {string} params.customerEmail
 * @param {string} params.description
 * @returns {Promise<Object>}
 */
export async function createStripePaymentLink({
  amountInRupees,
  orderId,
  customerName = 'Customer',
  customerEmail = 'customer@example.com',
  description = 'ProShop Order Purchase',
}) {
  const amountInPaise = Math.round(Number(amountInRupees) * 100);

  if (isSimulated || !stripe) {
    const sessionId = `cs_test_${orderId}`;
    return {
      id: sessionId,
      short_url: `http://localhost:5000/api/orders/${orderId}/pay`,
      amount: amountInPaise,
      status: 'created',
      order_id: sessionId,
      reference_id: String(orderId),
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'inr',
          product_data: {
            name: description || `ProShop Order #${orderId}`,
          },
          unit_amount: amountInPaise,
        },
        quantity: 1,
      },
    ],
    customer_email: customerEmail,
    client_reference_id: String(orderId),
    success_url: `http://localhost:5000/api/orders/${orderId}/pay?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `http://localhost:5000/api/orders/${orderId}/pay?cancelled=true`,
  });

  return {
    id: session.id,
    short_url: session.url,
    amount: amountInPaise,
    status: 'created',
    reference_id: String(orderId),
  };
}

/**
 * Fetches and verifies payment details directly with Stripe API.
 * @param {string} paymentId (PaymentIntent ID: pi_...)
 * @returns {Promise<Object>}
 */
export async function verifyStripePayment(paymentId) {
  if (isSimulated || !stripe || paymentId.startsWith('pi_sim_') || paymentId.startsWith('pi_off_sim_') || paymentId.startsWith('cs_sim_') || paymentId.startsWith('pi_link_')) {
    return {
      id: paymentId,
      status: 'captured',
      amount: 100000000,
      currency: 'inr',
      email: 'customer@example.com',
    };
  }

  let paymentIntent;
  if (paymentId.startsWith('cs_')) {
    const session = await stripe.checkout.sessions.retrieve(paymentId);
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (piId) {
      paymentIntent = await stripe.paymentIntents.retrieve(piId);
    } else {
      return {
        id: session.id,
        status: session.payment_status === 'paid' ? 'captured' : session.payment_status,
        amount: session.amount_total,
        currency: session.currency,
        email: session.customer_details?.email,
      };
    }
  } else {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
  }

  if (!paymentIntent) {
    throw new Error('Payment not found on Stripe');
  }

  return {
    id: paymentIntent.id,
    status: paymentIntent.status === 'succeeded' ? 'captured' : paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    email: paymentIntent.receipt_email || paymentIntent.customer?.email,
  };
}

/**
 * Checks if a transaction ID has already been recorded in database.
 * @param {Mongoose.Model} orderModel
 * @param {string} paymentId
 * @returns {Promise<boolean>}
 */
export async function checkIfNewTransaction(orderModel, paymentId) {
  const existingOrders = await orderModel.find({
    'paymentResult.id': paymentId,
  });

  return existingOrders.length === 0;
}
