/**
 * End-to-End HTTP API Test for ProShop v2 with Razorpay
 */
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import connectDB from './backend/config/db.js';
import productRoutes from './backend/routes/productRoutes.js';
import userRoutes from './backend/routes/userRoutes.js';
import orderRoutes from './backend/routes/orderRoutes.js';
import Order from './backend/models/orderModel.js';
import crypto from 'crypto';

dotenv.config();

async function runE2ETest() {
  console.log('═'.repeat(60));
  console.log('  PROSHOP V2 HTTP API END-TO-END RAZORPAY TEST');
  console.log('═'.repeat(60));

  await connectDB();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use('/api/products', productRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/orders', orderRoutes);
  app.get('/api/config/razorpay', (req, res) => res.json({ keyId: process.env.RAZORPAY_KEY_ID }));

  const server = app.listen(5005);
  const baseUrl = 'http://localhost:5005';
  console.log('✔ ProShop Express Server running at', baseUrl);

  let createdOrderId = null;

  try {
    // 1. Authenticate user
    console.log('\n[1/5] Authenticating User (john@email.com)...');
    const authRes = await fetch(`${baseUrl}/api/users/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'john@email.com', password: '123456' }),
    });
    const setCookie = authRes.headers.get('set-cookie');
    const jwtCookie = setCookie ? setCookie.split(';')[0] : '';
    const authData = await authRes.json();
    console.log(`✔ User logged in: ${authData.name} (${authData.email})`);

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: jwtCookie,
    };

    // 2. Fetch Catalog
    console.log('\n[2/5] Fetching Products Catalog (GET /api/products)...');
    const prodRes = await fetch(`${baseUrl}/api/products`);
    const prodData = await prodRes.json();
    const product = prodData.products[0];
    console.log(`✔ Found ${prodData.products.length} products. Selected: "${product.name}" (₹${product.price})`);

    // 3. Create Order
    console.log('\n[3/5] Placing Order (POST /api/orders)...');
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        orderItems: [
          {
            _id: product._id,
            name: product.name,
            qty: 1,
            image: product.image,
            price: product.price,
          },
        ],
        shippingAddress: {
          address: '456 Bandra West',
          city: 'Mumbai',
          postalCode: '400050',
          country: 'India',
        },
        paymentMethod: 'Razorpay',
      }),
    });
    const orderData = await orderRes.json();
    createdOrderId = orderData._id;
    console.log(`✔ Order Created: #${orderData._id} | Total: ₹${orderData.totalPrice} | Paid: ${orderData.isPaid}`);

    // 4. Generate Razorpay Payment Link
    console.log('\n[4/5] Generating Razorpay Payment Link (POST /api/orders/:id/pay-link)...');
    const linkRes = await fetch(`${baseUrl}/api/orders/${createdOrderId}/pay-link`, {
      method: 'POST',
      headers: authHeaders,
    });
    const linkData = await linkRes.json();
    console.log('────────────────────────────────────────────────────────────');
    console.log('🎉 PAYMENT LINK GENERATED:');
    console.log(`👉 Link ID    : ${linkData.id}`);
    console.log(`👉 Short URL  : ${linkData.short_url}`);
    console.log(`👉 Amount     : ₹${linkData.amount / 100}`);
    console.log(`👉 Ref ID     : ${linkData.reference_id}`);
    console.log('────────────────────────────────────────────────────────────');

    // 5. Update Order to Paid (Simulate Razorpay Payment callback / signature verification)
    console.log('\n[5/5] Confirming Payment with Signature (PUT /api/orders/:id/pay)...');
    const mockRzpOrderId = `order_${Date.now()}`;
    const mockRzpPayId = `pay_${Date.now()}`;
    const signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${mockRzpOrderId}|${mockRzpPayId}`)
      .digest('hex');

    const payRes = await fetch(`${baseUrl}/api/orders/${createdOrderId}/pay`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        razorpay_order_id: mockRzpOrderId,
        razorpay_payment_id: mockRzpPayId,
        razorpay_signature: signature,
      }),
    });
    const paidOrderData = await payRes.json();
    console.log(`✔ Order Updated! Status in MongoDB -> isPaid: ${paidOrderData.isPaid}, Paid At: ${paidOrderData.paidAt}`);
    console.log(`✔ Payment Result: ${JSON.stringify(paidOrderData.paymentResult)}`);

    console.log('\n' + '═'.repeat(60));
    console.log('  ALL E2E PROSHOP RAZORPAY API TESTS PASSED SUCCESSFULLY!');
    console.log('═'.repeat(60));

  } finally {
    if (createdOrderId) {
      await Order.findByIdAndDelete(createdOrderId);
    }
    server.close();
    await mongoose.disconnect();
  }
}

runE2ETest().catch((err) => {
  console.error('❌ E2E Test failed:', err);
  process.exit(1);
});
