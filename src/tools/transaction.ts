/**
 * MCP Transaction Tools
 * Exposes authoritative checkout, payment preparation, status polling,
 * and tamper-evident audit receipt inspection to AI buyer agents.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectorRuntime } from "../connector/runtime.js";
import { TransactionManager } from "../transaction/manager.js";
import { PolicyEngine } from "../policy/engine.js";
import { RazorpayAdapter, CreateOrderResult } from "../payment/razorpay.js";
import { AuditLedger } from "../audit/ledger.js";
import { TransactionState } from "../types/index.js";
import { generateDecisionReceipt } from "../audit/receipt.js";
import { MandateStore } from "../authz/mandate-store.js";
import { projectUcpEnvelope } from "../ucp/mapping.js";
import {
  toolInvokedEvent,
  toolCompletedEvent,
  toolFailedEvent,
  productResolvedEvent,
  checkoutCreatedEvent,
  policyEvaluatedEvent,
  paymentOrderCreatedEvent,
  paymentLinkGeneratedEvent,
  paymentCapturedEvent,
  orderConfirmedEvent,
  transactionCancelledEvent,
  refundRequestedEvent,
  refundInitiatedEvent,
  refundProcessedEvent,
  mandateEvaluatedEvent,
  mandateRejectedEvent,
  consentChallengedEvent,
  recurringTokenCapturedEvent,
  recurringPaymentChargedEvent,
  recurringPaymentFailedEvent,
} from "../audit/events.js";
import { AuthGuard } from "../auth/auth-guard.js";
import { RecurringTokenStore } from "../payment/token-store.js";
import { IntentMandate } from "../authz/types.js";

export function registerTransactionTools(
  server: McpServer,
  connector: ConnectorRuntime,
  txnManager: TransactionManager,
  policyEngine: PolicyEngine,
  paymentAdapter: RazorpayAdapter,
  auditLedger: AuditLedger,
  mandateStore?: MandateStore,
  authGuard?: AuthGuard,
  recurringTokenStore?: RecurringTokenStore
): void {
  // ─── Payment Capabilities Resource ─────────────────────────────────────────
  if (typeof (server as any).resource === "function") {
    (server as any).resource(
      "payment-capabilities",
      "merchant://payment-capabilities",
      {
        description: "Payment and autonomous checkout capabilities for this merchant.",
        mimeType: "application/json",
      },
      async () => {
        return {
          contents: [
            {
              uri: "merchant://payment-capabilities",
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  merchant: connector.getManifest().merchant.name,
                  supports_autonomous_payments: true,
                  payment_methods: ["hosted_payment_link", "razorpay_recurring_token"],
                  recurring_instruments: ["upi_autopay", "card_mandate"],
                  first_purchase_requirement:
                    "Provide customer_email and customer_contact in prepare_purchase. Returns one_time_payment_url and autopay_mandate_url. Present BOTH links directly to the user to choose. Do NOT open or automate links yourself.",
                  subsequent_purchase_requirement:
                    "If a recurring token exists, prepare_purchase returns consent_url. Present consent_url directly to the human user in your response to sign or reject the mandate.",
                  consent_rejection_policy:
                    "Users can reject mandates via the consent UI to receive a standard payment link without blocking the purchase.",
                  agent_guidance:
                    "CRITICAL: Agents must NEVER open, browse, or automate authentication URLs, payment links, or consent URLs. All links must be presented directly to the human user in the chat response.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  }

  // ─── prepare_purchase ───────────────────────────────────────────────────────
  server.tool(
    "prepare_purchase",
    "Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and either completes payment autonomously via a recurring token + AP2 mandate or generates hosted payment links.\n\n" +
    "AUTHENTICATION & CUSTOMER CONTEXT:\n" +
    "Customer identity (email, phone, customer ID) and saved recurring payment tokens are automatically resolved from the user's active session on the MCP server. The agent does NOT need to ask the human user for email or personal details.\n\n" +
    "CRITICAL AGENT INSTRUCTIONS:\n" +
    "1. When payment URLs (one_time_payment_url, autopay_mandate_url) or consent_url are returned, you must NEVER attempt to open, browse, or automate them yourself using browser tools.\n" +
    "2. You MUST present these URLs directly to the human user in your chat response so the user can make their payment or authorize the mandate in their own browser.\n" +
    "3. On first purchase, present BOTH the one-time payment link and the autopay mandate link to the user and explain the difference clearly.",
    {
      product_id: z.string().describe("The product/offer ID to purchase"),
      quantity: z.number().int().positive().default(1).describe("Quantity to purchase"),
      variant: z.record(z.string()).optional().describe("Optional variant selections, e.g. { color: 'black', size: '10' }"),
      customer_data: z.record(z.unknown()).optional().describe("Customer contact/shipping details if required by merchant"),
      selection_reason: z.string().describe("Explanation of why the agent chose this item (recorded for audit trail)"),
      authorization_reference: z.string().optional().describe("Signed Intent Mandate or Payment Mandate authorization reference (AP2)"),
      recurring_token: z.string().optional().describe("Optional Razorpay recurring payment token. Automatically resolved from the user session if already saved."),
      customer_id: z.string().optional().describe("Optional. Automatically resolved from the user's active session if logged in."),
      customer_email: z.string().optional().describe("Optional. Automatically resolved from the user's active session if logged in. Do NOT ask user for email."),
      customer_contact: z.string().optional().describe("Optional. Automatically resolved from the user's active session if logged in."),
      session_id: z.string().optional().describe("Optional active session ID. If omitted, the MCP server automatically checks for the active user session."),
    },
    async (params) => {
      const manifest = connector.getManifest();
      const cartModel = manifest.transaction?.cart?.model ?? "single_item";
      if (cartModel === "multi_item") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "This merchant uses multi-item carts. Use add_to_cart to build your cart, then checkout_cart.",
                  suggestion: "add_to_cart",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Check required customer data
      const customerConfig = manifest.transaction?.customer_data;
      if (customerConfig?.required && customerConfig.required.length > 0) {
        const missingFields = customerConfig.required
          .filter((field) => !params.customer_data?.[field.field])
          .map((f) => ({ field: f.field, label: f.label, type: f.type }));

        if (missingFields.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "customer_data_required",
                    required_fields: missingFields,
                    optional_fields: customerConfig.optional ?? [],
                    message: "Please provide the required customer data to proceed with checkout.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      // Check user authentication requirements via AuthGuard
      let sessionToken: string | undefined = undefined;
      const sessionStore = authGuard ? authGuard.getSessionStore() : undefined;
      let activeSession: import("../auth/session-store.js").UserSession | null = null;

      if (authGuard) {
        const authResult = await authGuard.check("create_checkout", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      // Authoritative Session-Based Customer Identity Resolution
      // The session stored upon user login/signup is the authoritative source for customer details.
      // The agent does NOT need to ask the user or pass customer details.
      if (sessionStore) {
        if (params.session_id) {
          activeSession = sessionStore.getSession(params.session_id);
        }
        if (!activeSession) {
          activeSession = sessionStore.getActiveSession();
        }
      }

      // Resolve effective customer credentials authoritative from active user session
      let effectiveCustomerEmail: string | undefined = undefined;
      let effectiveCustomerContact: string | undefined = undefined;
      let effectiveCustomerId: string | undefined = undefined;
      let effectiveRecurringToken: string | undefined = params.recurring_token;

      if (activeSession) {
        effectiveCustomerEmail =
          activeSession.user_email ||
          (activeSession.user_name && activeSession.user_name.includes("@") ? activeSession.user_name : undefined) ||
          (activeSession.user_id && activeSession.user_id.includes("@") ? activeSession.user_id : undefined);

        effectiveCustomerContact = activeSession.user_contact;
        effectiveCustomerId = activeSession.customer_id;

        // If recurring token exists for this authenticated user session
        if (!effectiveRecurringToken && recurringTokenStore) {
          if (effectiveCustomerId) {
            const saved = recurringTokenStore.get(effectiveCustomerId);
            if (saved) effectiveRecurringToken = saved.token_id;
          }
          if (!effectiveRecurringToken && effectiveCustomerEmail) {
            const saved = recurringTokenStore.getByEmail(effectiveCustomerEmail);
            if (saved) {
              effectiveRecurringToken = saved.token_id;
              if (!effectiveCustomerId) effectiveCustomerId = saved.customer_id;
            }
          }
        }
      }

      // Fallback to explicit params if provided by agent, or if guest checkout
      if (!effectiveCustomerEmail && params.customer_email) {
        effectiveCustomerEmail = params.customer_email;
      }
      if (!effectiveCustomerContact && params.customer_contact) {
        effectiveCustomerContact = params.customer_contact;
      }
      if (!effectiveCustomerId && params.customer_id) {
        effectiveCustomerId = params.customer_id;
      }

      if (!effectiveRecurringToken && recurringTokenStore) {
        if (effectiveCustomerId) {
          const saved = recurringTokenStore.get(effectiveCustomerId);
          if (saved) effectiveRecurringToken = saved.token_id;
        } else if (effectiveCustomerEmail) {
          const saved = recurringTokenStore.getByEmail(effectiveCustomerEmail);
          if (saved) {
            effectiveRecurringToken = saved.token_id;
            effectiveCustomerId = saved.customer_id;
          }
        } else {
          // Fallback: If agent didn't pass customer_id or email, check if any token was saved from a previous mandate setup
          const allTokens = recurringTokenStore.listAll();
          if (allTokens.length > 0) {
            const latest = allTokens[allTokens.length - 1];
            effectiveRecurringToken = latest.token_id;
            effectiveCustomerId = latest.customer_id;
            if (latest.email) effectiveCustomerEmail = latest.email;
            if (latest.contact) effectiveCustomerContact = latest.contact;
          }
        }
      }

      // Auto-provision customer_id if not present, so Razorpay Mandate Orders can always be created
      if (!effectiveCustomerId) {
        if (paymentAdapter) {
          try {
            const custRes = await paymentAdapter.createCustomer({
              name: activeSession?.user_name || "ProShop Customer",
              email: effectiveCustomerEmail || (activeSession?.user_id ? `${activeSession.user_id}@proshop.local` : `buyer_${Date.now()}@proshop.local`),
              contact: effectiveCustomerContact || "+919999999999",
            });
            effectiveCustomerId = custRes.customer_id;
            if (activeSession && sessionStore) {
              sessionStore.attachCustomerId(activeSession.session_id, effectiveCustomerId);
            }
          } catch (custErr) {
            effectiveCustomerId = `cust_${Date.now()}`;
          }
        } else {
          effectiveCustomerId = `cust_${Date.now()}`;
        }
      }

      // 1. Create Transaction in CREATED state with MCP-generated ID
      const txn = txnManager.create({
        product_id: params.product_id,
        quantity: params.quantity,
        variant: params.variant,
        selection_reason: params.selection_reason,
      });
      txn.customer_id = effectiveCustomerId;
      const txnId = txn.transaction_id;

      auditLedger.append(
        toolInvokedEvent(txnId, "prepare_purchase", params)
      );

      try {
        // 2. Resolve Product from merchant catalog
        const offer = sessionToken
          ? await connector.getProduct(params.product_id, sessionToken)
          : await connector.getProduct(params.product_id);
        auditLedger.append(productResolvedEvent(txnId, offer));

        if (offer.availability === "out_of_stock") {
          txnManager.fail(txnId, `Product ${params.product_id} is out of stock`, "catalog_resolver");
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  transaction_id: txnId,
                  state: TransactionState.FAILED,
                  error: `Product "${offer.title}" (${params.product_id}) is currently out of stock.`,
                }, null, 2),
              },
            ],
          };
        }

        // Check for ephemeral offer expiration (Component 4)
        if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
          txnManager.fail(txnId, `Offer expired at ${offer.expires_at} (ephemeral offer)`, "catalog_resolver");
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    transaction_id: txnId,
                    state: TransactionState.FAILED,
                    error: `Offer "${offer.title}" expired at ${offer.expires_at}. Re-run discovery for a fresh quote.`,
                    recoverable: true,
                    suggestion: "search_products",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 3. Create Authoritative Merchant Checkout
        const checkout = sessionToken
          ? await connector.createCheckout(
            params.product_id,
            params.quantity,
            params.variant,
            params.customer_data,
            sessionToken
          )
          : await connector.createCheckout(
            params.product_id,
            params.quantity,
            params.variant,
            params.customer_data
          );

        txnManager.bindCheckout(txnId, {
          ...checkout,
          title: offer.title,
        });
        txnManager.transition(txnId, TransactionState.CHECKOUT_CREATED, "merchant_checkout_created");
        auditLedger.append(checkoutCreatedEvent(txnId, checkout));

        // 4. Mandate Authorization Check (AP2)
        let effectiveAuthRef = params.authorization_reference;

        if (mandateStore && mandateStore.isAuthModeEnabled()) {
          if (params.authorization_reference) {
            const signed = await mandateStore.getMandate(params.authorization_reference);
            if (!signed) {
              txnManager.fail(
                txnId,
                `Authorization reference "${params.authorization_reference}" not found`,
                "mandate_broker"
              );
              auditLedger.append(
                mandateRejectedEvent(
                  txnId,
                  `Authorization reference "${params.authorization_reference}" not found`
                )
              );
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      error: `Authorization reference "${params.authorization_reference}" not found`,
                    }),
                  },
                ],
              };
            }

            if (signed.mandate.kind === "intent") {
              const derived = await mandateStore.derivePaymentMandate(
                txnManager.get(txnId),
                params.authorization_reference,
                false,
                connector.getManifest().merchant.name
              );

              if (derived.status === "denied") {
                txnManager.fail(txnId, derived.reason, "mandate_broker");
                auditLedger.append(mandateRejectedEvent(txnId, derived.reason));
                return {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        error: `Mandate authorization denied: ${derived.reason}`,
                      }),
                    },
                  ],
                };
              }

              if (derived.status === "authorized") {
                effectiveAuthRef = derived.authorization_reference;
                txnManager.get(txnId).authorization_reference = effectiveAuthRef;
                auditLedger.append(
                  mandateEvaluatedEvent(txnId, {
                    status: "authorized",
                    mandate_id: effectiveAuthRef,
                    approved_by: "derived_from_intent",
                  })
                );
              }
            } else {
              effectiveAuthRef = params.authorization_reference;
              txnManager.get(txnId).authorization_reference = effectiveAuthRef;
              auditLedger.append(
                mandateEvaluatedEvent(txnId, {
                  status: "authorized",
                  mandate_id: effectiveAuthRef,
                  approved_by: "user_jit",
                })
              );
            }
          } else if (effectiveRecurringToken) {
            // Mode B: JIT Human Consent Required when recurring token is available without an advance mandate
            const deriveResult = await mandateStore.derivePaymentMandate(
              txnManager.get(txnId),
              undefined,
              false,
              connector.getManifest().merchant.name
            );

            if (deriveResult.status === "consent_required") {
              const challenge = deriveResult.consent_challenge;
              txnManager.transition(txnId, TransactionState.MANDATE_EVALUATED, "consent_challenge_issued");
              auditLedger.append(consentChallengedEvent(txnId, challenge));
              auditLedger.append(
                toolCompletedEvent(txnId, "prepare_purchase", {
                  transaction_id: txnId,
                  state: TransactionState.MANDATE_EVALUATED,
                  payment_status: "consent_required",
                  consent_url: challenge.consent_url,
                })
              );

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        transaction_id: txnId,
                        state: TransactionState.MANDATE_EVALUATED,
                        payment: {
                          status: "consent_required",
                          consent_url: challenge.consent_url,
                          challenge_id: challenge.challenge_id,
                          expires_at: challenge.expires_at,
                          instructions_for_agent:
                            "CRITICAL: Do NOT attempt to visit, open, or automate this consent_url yourself using browser tools. You MUST present this consent_url directly to the human user in your chat response so they can review, approve, or reject the purchase mandate in their own browser. Once the user responds or takes action, re-poll get_transaction_status.",
                          message:
                            "A saved recurring payment token exists for this customer. Do NOT open this URL yourself. Present consent_url directly to the human user in your response to review and sign the purchase mandate, then re-poll get_transaction_status.",
                        },
                        checkout: {
                          checkout_id: checkout.checkout_id,
                          total: checkout.total,
                        },
                        ucp: projectUcpEnvelope(txnManager.get(txnId), {
                          "com.merchantmcp.mandates.consent": [
                            {
                              id: challenge.challenge_id,
                              config: {
                                consent_url: challenge.consent_url,
                                expires_at: challenge.expires_at,
                              },
                            },
                          ],
                        }),
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
          }
        }

        // 5. Evaluate Policy Engine (Gate the money action)
        const isManualFirstPurchase = !effectiveRecurringToken && !params.authorization_reference;
        const policyDecision = policyEngine.evaluate(txnManager.get(txnId), "CREATE_PAYMENT", {
          authorization_reference: effectiveAuthRef,
          recurring_token: effectiveRecurringToken,
          bypass_mandate_for_manual_link: isManualFirstPurchase,
        });
        txnManager.bindPolicyDecision(txnId, policyDecision);
        auditLedger.append(policyEvaluatedEvent(txnId, policyDecision));

        if (policyDecision.decision === "DENY") {
          const failureDetails = policyDecision.checks
            .filter((c) => c.result === "FAIL")
            .map((c) => `[${c.gate}] ${c.detail}`)
            .join("; ");

          txnManager.fail(txnId, `Policy check denied: ${failureDetails}`, "policy_engine");

          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  transaction_id: txnId,
                  state: TransactionState.FAILED,
                  error: `Purchase policy evaluation denied: ${failureDetails}`,
                  policy: policyDecision,
                }, null, 2),
              },
            ],
          };
        }

        // 5. Create Customer entity in Razorpay if details provided (for recurring token registration)
        let customerId: string | undefined = effectiveCustomerId;
        if (!customerId && (effectiveCustomerEmail || effectiveCustomerContact)) {
          try {
            const customerResult = await paymentAdapter.createCustomer({
              email: effectiveCustomerEmail || "",
              contact: effectiveCustomerContact || "",
            });
            customerId = customerResult.customer_id;
            effectiveCustomerId = customerId;
            txnManager.get(txnId).customer_id = customerId;
          } catch (custErr) {
            console.warn("[Transaction] Customer creation failed, proceeding with guest checkout:", custErr);
          }
        }
        if (effectiveCustomerId) {
          txnManager.get(txnId).customer_id = effectiveCustomerId;
        }

        // 6. Create Payment Order with Razorpay
        const orderResult = await paymentAdapter.createOrder({
          amount: checkout.total,
          receipt: txnId,
          notes: {
            transaction_id: txnId,
            product_id: params.product_id,
            ...(effectiveCustomerId ? { customer_id: effectiveCustomerId } : {}),
            ...(effectiveRecurringToken ? { recurring_token: effectiveRecurringToken } : {}),
          },
          manifestPaymentConfig: manifest.payment,
        });
        auditLedger.append(
          paymentOrderCreatedEvent(txnId, {
            order_id: orderResult.order_id,
            amount: checkout.total.amount,
            currency: checkout.total.currency,
          })
        );

        // ════════════════════════════════════════════════════════════════════════
        // PATH 2: AUTONOMOUS PAYMENT (Token + Mandate)
        // ════════════════════════════════════════════════════════════════════════
        if (effectiveRecurringToken && effectiveCustomerId && effectiveAuthRef) {
          try {
            const chargeResult = await paymentAdapter.chargeRecurringToken({
              customer_id: effectiveCustomerId,
              token_id: effectiveRecurringToken,
              amount: checkout.total,
              order_id: orderResult.order_id,
              email: effectiveCustomerEmail || "",
              contact: effectiveCustomerContact || "",
              description: `Autonomous Purchase: ${offer.title} (x${params.quantity})`,
            });

            // Audit recurring charge
            auditLedger.append(
              recurringPaymentChargedEvent(txnId, {
                payment_id: chargeResult.payment_id,
                token_id: effectiveRecurringToken!,
                customer_id: effectiveCustomerId,
                amount: checkout.total.amount,
                currency: checkout.total.currency,
              })
            );

            // Bind payment
            txnManager.bindPayment(txnId, {
              provider: "razorpay",
              payment_method: "recurring_token",
              razorpay_order_id: orderResult.order_id,
              razorpay_payment_id: chargeResult.payment_id,
              payment_status: chargeResult.status === "captured" ? "captured" : "authorized",
              customer_id: effectiveCustomerId,
              customer_email: params.customer_email,
              customer_contact: params.customer_contact,
              recurring_token_id: params.recurring_token,
              token_captured: true,
            });

            txnManager.transition(txnId, TransactionState.PAYMENT_AUTHORIZED, "recurring_token_charged");

            // Auto-confirm order with merchant
            const authResult = await authGuard?.check("confirm_order");
            const sessionToken = authResult?.access_token;
            const order = await connector.confirmOrder(
              checkout.checkout_id,
              chargeResult.payment_id,
              sessionToken ? { sessionToken } : undefined
            );

            txnManager.bindOrder(txnId, order);
            txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "autonomous_payment_confirmed");
            auditLedger.append(orderConfirmedEvent(txnId, order));

            // Update token last_used_at in store
            if (recurringTokenStore) {
              const existingTok = recurringTokenStore.get(effectiveCustomerId);
              if (existingTok) {
                existingTok.last_used_at = new Date().toISOString();
                recurringTokenStore.save(existingTok);
              }
            }

            auditLedger.append(
              toolCompletedEvent(txnId, "prepare_purchase", {
                transaction_id: txnId,
                state: TransactionState.ORDER_CONFIRMED,
                payment_method: "recurring_token",
                payment_id: chargeResult.payment_id,
                order_id: order.order_id,
              })
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      transaction_id: txnId,
                      state: TransactionState.ORDER_CONFIRMED,
                      checkout: {
                        checkout_id: checkout.checkout_id,
                        sku: checkout.sku,
                        unit_price: checkout.unit_price,
                        total: checkout.total,
                      },
                      payment: {
                        status: "payment_completed",
                        payment_method: "recurring_token",
                        payment_id: chargeResult.payment_id,
                        razorpay_order_id: orderResult.order_id,
                        message: "Payment completed autonomously via recurring token. No user action was required.",
                      },
                      order: {
                        order_id: order.order_id,
                        status: order.status,
                        confirmed_at: order.confirmed_at,
                      },
                      policy: policyDecision,
                      ucp: projectUcpEnvelope(txnManager.get(txnId)),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (chargeErr) {
            // Recurring charge failed — audit and fall back to payment link
            auditLedger.append(
              recurringPaymentFailedEvent(txnId, {
                token_id: effectiveRecurringToken!,
                customer_id: effectiveCustomerId,
                error: (chargeErr as Error).message,
              })
            );
            console.warn("[Transaction] Recurring charge failed, falling back to payment link:", chargeErr);
          }
        }

        // 7. Generate Payment Link with Razorpay (Path 1 / Path 3 Fallback)
        const linkResult = await paymentAdapter.createPaymentLink({
          amount: checkout.total,
          description: `Purchase: ${offer.title} (x${params.quantity})`,
          reference_id: txnId,
          order_id: orderResult.order_id,
          customer: effectiveCustomerEmail || effectiveCustomerContact ? {
            email: effectiveCustomerEmail,
            contact: effectiveCustomerContact,
          } : undefined,
          manifestPaymentConfig: manifest.payment,
        });

        auditLedger.append(
          paymentLinkGeneratedEvent(txnId, {
            payment_link_id: linkResult.payment_link_id,
            short_url: linkResult.short_url,
            amount: checkout.total.amount,
          })
        );

        // 8. Generate Autopay Mandate Registration Order & Link (for First Purchase / non-tokenized customer)
        let mandateOrderResult: CreateOrderResult | undefined;
        let autopayMandateUrl: string | undefined;

        if (!effectiveRecurringToken && effectiveCustomerId) {
          try {
            mandateOrderResult = await paymentAdapter.createOrder({
              amount: checkout.total,
              receipt: `${txnId}_mandate`,
              customer_id: effectiveCustomerId,
              enable_recurring_mandate: true,
              notes: {
                transaction_id: txnId,
                product_id: params.product_id,
                customer_id: effectiveCustomerId,
                mandate: "true",
              },
              manifestPaymentConfig: manifest.payment,
            });

            const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
            autopayMandateUrl = `http://localhost:${callbackPort}/pay?order_id=${mandateOrderResult.order_id}&amount=${checkout.total.amount}&currency=${checkout.total.currency}&desc=${encodeURIComponent(`Autopay Mandate Setup: ${offer.title}`)}&txn_id=${txnId}&mode=mandate&customer_id=${effectiveCustomerId}${effectiveCustomerEmail ? `&customer_email=${encodeURIComponent(effectiveCustomerEmail)}` : ""}${effectiveCustomerContact ? `&customer_contact=${encodeURIComponent(effectiveCustomerContact)}` : ""}`;
          } catch (mErr) {
            console.warn("[Transaction] Failed to create mandate order, falling back to local mandate URL:", mErr);
          }
        }

        if (!autopayMandateUrl && !effectiveRecurringToken) {
          const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
          autopayMandateUrl = `http://localhost:${callbackPort}/pay?order_id=${orderResult.order_id}&amount=${checkout.total.amount}&currency=${checkout.total.currency}&desc=${encodeURIComponent(`Autopay Mandate: ${offer.title}`)}&txn_id=${txnId}&mode=mandate${effectiveCustomerId ? `&customer_id=${effectiveCustomerId}` : ""}${effectiveCustomerEmail ? `&customer_email=${encodeURIComponent(effectiveCustomerEmail)}` : ""}${effectiveCustomerContact ? `&customer_contact=${encodeURIComponent(effectiveCustomerContact)}` : ""}`;
        }

        const oneTimePaymentUrl = linkResult.short_url;

        // 9. Generate Checkout SDK Session info
        const checkoutSession = await paymentAdapter.createCheckoutSession({
          order_id: orderResult.order_id,
          amount: checkout.total,
          merchant_name: connector.getManifest().merchant.name,
          description: `Purchase: ${offer.title} (x${params.quantity})`,
          prefill: {
            email: effectiveCustomerEmail,
            contact: effectiveCustomerContact,
          },
        });

        // 10. Bind Payment Data and Transition to PAYMENT_PENDING
        txnManager.bindPayment(txnId, {
          provider: "razorpay",
          payment_method: "payment_link",
          razorpay_order_id: orderResult.order_id,
          payment_link_id: linkResult.payment_link_id,
          payment_link_url: oneTimePaymentUrl,
          one_time_payment_url: oneTimePaymentUrl,
          autopay_mandate_url: autopayMandateUrl,
          razorpay_mandate_order_id: mandateOrderResult?.order_id,
          payment_status: "pending",
          customer_id: effectiveCustomerId,
          customer_email: effectiveCustomerEmail,
          customer_contact: effectiveCustomerContact,
        });

        txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "payment_link_created");

        const responsePayload = {
          transaction_id: txnId,
          state: TransactionState.PAYMENT_PENDING,
          checkout: {
            checkout_id: checkout.checkout_id,
            sku: checkout.sku,
            unit_price: checkout.unit_price,
            total: checkout.total,
            expires_at: checkout.expires_at,
          },
          payment: {
            status: "user_action_required",
            payment_url: oneTimePaymentUrl,
            one_time_payment_url: oneTimePaymentUrl,
            ...(autopayMandateUrl ? { autopay_mandate_url: autopayMandateUrl } : {}),
            razorpay_order_id: orderResult.order_id,
            ...(mandateOrderResult ? { razorpay_mandate_order_id: mandateOrderResult.order_id } : {}),
            instructions_for_agent:
              "CRITICAL: Do NOT attempt to visit, open, or automate these payment links yourself via browser tools. You MUST present these links directly to the human user in your chat response so the user can choose and complete payment in their own browser.",
            methods: {
              payment_link: {
                url: oneTimePaymentUrl,
                description: "Hosted Razorpay payment link for manual one-time payment",
              },
              one_time: {
                url: oneTimePaymentUrl,
                description: "Single one-time payment for this order only (no autopay mandate)",
              },
              ...(autopayMandateUrl ? {
                autopay_mandate: {
                  url: autopayMandateUrl,
                  description: "Payment + Autopay mandate authorization for future autonomous agent purchases",
                }
              } : {}),
              checkout_sdk: {
                razorpay_key_id: checkoutSession.razorpay_key_id,
                razorpay_order_id: orderResult.order_id,
                amount: checkoutSession.amount.amount,
                currency: checkoutSession.currency,
                merchant_name: checkoutSession.merchant_name,
                description: checkoutSession.description,
                instructions: "Use these parameters to render Razorpay Standard Checkout in a web/native host",
              },
            },
            message: autopayMandateUrl
              ? "Do NOT open these links yourself. Present BOTH payment options clearly to the user in your response: " +
                "1) One-Time Payment: Pay for this order once via one_time_payment_url without setting up autopay. " +
                "2) Autopay Mandate: Pay and authorize an autopay mandate via autopay_mandate_url so future purchases can be completed autonomously by the agent without manual checkout links. " +
                "Ask the user which option they prefer."
              : "Do NOT open this link yourself. Complete payment manually via one_time_payment_url.",
          },
          policy: {
            decision: policyDecision.decision,
            checks: policyDecision.checks,
          },
          ucp: projectUcpEnvelope(txnManager.get(txnId)),
        };

        auditLedger.append(
          toolCompletedEvent(txnId, "prepare_purchase", responsePayload)
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responsePayload, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const errorMsg = (err as Error).message;
        txnManager.fail(txnId, errorMsg, "prepare_purchase_tool");
        auditLedger.append(toolFailedEvent(txnId, "prepare_purchase", errorMsg));

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                transaction_id: txnId,
                state: TransactionState.FAILED,
                error: errorMsg,
              }, null, 2),
            },
          ],
        };
      }
    }
  );

  // ─── get_transaction_status ─────────────────────────────────────────────────
  server.tool(
    "get_transaction_status",
    "Poll or retrieve the real-time status of an ongoing transaction. Automatically finalizes order confirmation when payment authorization is received. CRITICAL: If a payment_url, one_time_payment_url, autopay_mandate_url, or consent_url is returned, the agent must NOT open or automate it; present it directly to the human user in the response.",
    {
      transaction_id: z.string().describe("Transaction ID returned from prepare_purchase"),
    },
    async (params) => {
      const txnId = params.transaction_id;
      if (!txnManager.has(txnId)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Transaction "${txnId}" not found.` }),
            },
          ],
        };
      }

      const txn = txnManager.get(txnId);

      // Auto-progress if mandate was approved via JIT consent challenge while polling
      if (
        txn.state === TransactionState.MANDATE_EVALUATED &&
        txn.authorization_reference &&
        txn.merchant_verified
      ) {
        try {
          const checkout = txn.merchant_verified;

          // Resolve customer ID and recurring token first
          let effectiveCustomerId = txn.customer_id || txn.payment?.customer_id;
          let effectiveRecurringToken = txn.payment?.recurring_token_id;
          let effectiveCustomerEmail = txn.payment?.customer_email;
          let effectiveCustomerContact = txn.payment?.customer_contact;

          const sessionStore = authGuard?.getSessionStore?.();
          if (sessionStore) {
            const activeSession = sessionStore.getActiveSession();
            if (activeSession) {
              if (!effectiveCustomerId && activeSession.customer_id) effectiveCustomerId = activeSession.customer_id;
              if (!effectiveCustomerEmail && activeSession.user_email) effectiveCustomerEmail = activeSession.user_email;
              if (!effectiveCustomerContact && activeSession.user_contact) effectiveCustomerContact = activeSession.user_contact;
            }
          }

          if (!effectiveRecurringToken && effectiveCustomerId && recurringTokenStore) {
            const tok = recurringTokenStore.get(effectiveCustomerId);
            if (tok) effectiveRecurringToken = tok.token_id;
          }

          // Evaluate policy for CREATE_PAYMENT only if not already evaluated for this txn
          let policyDecision = txn.policy_decision;
          if (!policyDecision) {
            policyDecision = policyEngine.evaluate(txn, "CREATE_PAYMENT", {
              authorization_reference: txn.authorization_reference,
            });
            txnManager.bindPolicyDecision(txnId, policyDecision);
            auditLedger.append(policyEvaluatedEvent(txnId, policyDecision));
          }

          if (policyDecision.decision === "ALLOW") {
            const orderResult = await paymentAdapter.createOrder({
              amount: checkout.total,
              receipt: txnId,
              customer_id: effectiveCustomerId,
              notification: effectiveRecurringToken ? { token_id: effectiveRecurringToken } : undefined,
              notes: { transaction_id: txnId, product_id: txn.agent_claim.product_id },
            });
            auditLedger.append(
              paymentOrderCreatedEvent(txnId, {
                order_id: orderResult.order_id,
                amount: checkout.total.amount,
                currency: checkout.total.currency,
              })
            );

            if (effectiveRecurringToken && effectiveCustomerId) {
              try {
                const chargeResult = await paymentAdapter.chargeRecurringToken({
                  customer_id: effectiveCustomerId,
                  token_id: effectiveRecurringToken,
                  amount: checkout.total,
                  order_id: orderResult.order_id,
                  email: effectiveCustomerEmail || "",
                  contact: effectiveCustomerContact || "",
                  description: `Autonomous Purchase: ${checkout.title ?? txn.agent_claim.product_id} (x${txn.agent_claim.quantity})`,
                });

                auditLedger.append(
                  recurringPaymentChargedEvent(txnId, {
                    payment_id: chargeResult.payment_id,
                    token_id: effectiveRecurringToken,
                    customer_id: effectiveCustomerId,
                    amount: checkout.total.amount,
                    currency: checkout.total.currency,
                  })
                );

                txnManager.bindPayment(txnId, {
                  provider: "razorpay",
                  payment_method: "recurring_token",
                  razorpay_order_id: orderResult.order_id,
                  razorpay_payment_id: chargeResult.payment_id,
                  payment_status: "captured",
                  customer_id: effectiveCustomerId,
                  customer_email: effectiveCustomerEmail,
                  customer_contact: effectiveCustomerContact,
                  recurring_token_id: effectiveRecurringToken,
                  token_captured: true,
                });

                txnManager.transition(txnId, TransactionState.PAYMENT_AUTHORIZED, "recurring_token_charged");

                const authResult = await authGuard?.check("confirm_order");
                const sessionToken = authResult?.access_token;
                const order = await connector.confirmOrder(
                  checkout.checkout_id,
                  chargeResult.payment_id,
                  sessionToken ? { sessionToken } : undefined
                );

                txnManager.bindOrder(txnId, order);
                txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "autonomous_payment_confirmed");
                auditLedger.append(orderConfirmedEvent(txnId, order));
              } catch (recErr: any) {
                console.warn("[Transaction] Recurring charge failed in JIT progression:", recErr);
                const callbackPort = Number(process.env.AUTH_CALLBACK_PORT || 3002);
                const paymentUrl = `http://localhost:${callbackPort}/pay?order_id=${orderResult.order_id}&amount=${checkout.total.amount}&currency=${checkout.total.currency}&desc=${encodeURIComponent(`Complete Purchase: ${checkout.title ?? txn.agent_claim.product_id}`)}&txn_id=${txnId}&customer_id=${effectiveCustomerId || ""}`;

                txnManager.bindPayment(txnId, {
                  provider: "razorpay",
                  payment_method: "payment_link",
                  razorpay_order_id: orderResult.order_id,
                  payment_status: "pending",
                  payment_link_url: paymentUrl,
                  one_time_payment_url: paymentUrl,
                  customer_id: effectiveCustomerId,
                  customer_email: effectiveCustomerEmail,
                  customer_contact: effectiveCustomerContact,
                  recurring_token_id: effectiveRecurringToken,
                });

                txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "recurring_charge_pending_manual_fallback");
                (txn as any).error_detail = recErr.message || String(recErr);
              }
            } else {
              const linkResult = await paymentAdapter.createPaymentLink({
                amount: checkout.total,
                description: `Purchase: ${checkout.title ?? txn.agent_claim.product_id} (x${txn.agent_claim.quantity})`,
                reference_id: txnId,
              });
              auditLedger.append(
                paymentLinkGeneratedEvent(txnId, {
                  payment_link_id: linkResult.payment_link_id,
                  short_url: linkResult.short_url,
                  amount: checkout.total.amount,
                })
              );

              txnManager.bindPayment(txnId, {
                provider: "razorpay",
                razorpay_order_id: orderResult.order_id,
                payment_link_id: linkResult.payment_link_id,
                payment_link_url: linkResult.short_url,
                payment_status: "pending",
              });
              txnManager.transition(txnId, TransactionState.PAYMENT_PENDING, "jit_consent_authorized");
            }
          }
        } catch (err: unknown) {
          console.error("JIT mandate progression error:", err);
        }
      }

      // Active Razorpay Polling: If payment is pending, poll Razorpay to verify if user completed payment
      if (txn.state === TransactionState.PAYMENT_PENDING && txn.payment) {
        try {
          let verifiedPayment: { payment_id: string; status: string } | null = null;
          if (txn.payment.razorpay_mandate_order_id) {
            verifiedPayment = await paymentAdapter.checkOrderPayment(txn.payment.razorpay_mandate_order_id);
          }
          if (!verifiedPayment && txn.payment.razorpay_order_id) {
            verifiedPayment = await paymentAdapter.checkOrderPayment(txn.payment.razorpay_order_id);
          }
          if (!verifiedPayment && txn.payment.payment_link_id) {
            verifiedPayment = await paymentAdapter.checkPaymentLink(txn.payment.payment_link_id);
          }

          if (verifiedPayment && (verifiedPayment.status === "captured" || verifiedPayment.status === "authorized")) {
            txnManager.bindPayment(txnId, {
              ...txn.payment,
              provider: "razorpay",
              razorpay_payment_id: verifiedPayment.payment_id,
              payment_status: verifiedPayment.status,
            });
            txnManager.transition(txnId, TransactionState.PAYMENT_AUTHORIZED, "payment_verified_via_polling");
            if (txn.merchant_verified?.total) {
              auditLedger.append(
                paymentCapturedEvent(txnId, {
                  payment_id: verifiedPayment.payment_id,
                  amount: txn.merchant_verified.total.amount,
                  currency: txn.merchant_verified.total.currency,
                })
              );
            }
          }
        } catch (err: unknown) {
          console.error("[Transaction] Error polling payment status from Razorpay:", err);
        }
      }

      // Auto-reconciliation: If payment was authorized (via webhook OR polling) but merchant order not yet confirmed, confirm it now
      const currentTxn = txnManager.get(txnId);
      if (
        currentTxn.state === TransactionState.PAYMENT_AUTHORIZED &&
        !currentTxn.merchant_order &&
        currentTxn.merchant_verified?.checkout_id &&
        currentTxn.payment?.razorpay_payment_id
      ) {
        try {
          const authResult = await authGuard?.check("confirm_order");
          const sessionToken = authResult?.access_token;
          const order = await connector.confirmOrder(
            currentTxn.merchant_verified.checkout_id,
            currentTxn.payment.razorpay_payment_id,
            sessionToken ? { sessionToken } : undefined
          );

          txnManager.bindOrder(txnId, order);
          txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_confirmed");
          auditLedger.append(orderConfirmedEvent(txnId, order));
        } catch (err: unknown) {
          const errMsg = (err as Error).message || "";
          if (errMsg.includes("already been processed") || errMsg.includes("already paid")) {
            const fallbackOrder = {
              order_id: currentTxn.merchant_verified.checkout_id,
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
            };
            txnManager.bindOrder(txnId, fallbackOrder);
            txnManager.transition(txnId, TransactionState.ORDER_CONFIRMED, "merchant_order_confirmed");
            auditLedger.append(orderConfirmedEvent(txnId, fallbackOrder));
          } else {
            console.error("Order confirmation failed:", err);
            txnManager.fail(txnId, `Order confirmation failed: ${errMsg}`, "order_manager");
          }
        }
      }

      // Token capture: after payment is confirmed on a manual first purchase, capture token for future autonomous checkout
      let capturedTokenInfo: { recurring_token: string; customer_id: string } | undefined;
      const orderConfirmedTxn = txnManager.get(txnId);
      const targetCustomerId = orderConfirmedTxn.customer_id || orderConfirmedTxn.payment?.customer_id;

      if (
        orderConfirmedTxn.state === TransactionState.ORDER_CONFIRMED &&
        orderConfirmedTxn.payment?.payment_method !== "recurring_token" &&
        targetCustomerId &&
        !orderConfirmedTxn.token_captured
      ) {
        try {
          // 1. Check if token_id is available directly from the authorized payment
          let capturedTokenId: string | undefined;
          let capturedMethod = "card";
          let capturedMaxAmount = 10000000;

          if (orderConfirmedTxn.payment?.razorpay_payment_id && (paymentAdapter as any).fetchTokenForPayment) {
            capturedTokenId = await (paymentAdapter as any).fetchTokenForPayment(orderConfirmedTxn.payment.razorpay_payment_id);
          }

          // 2. Otherwise query tokens attached to the customer in Razorpay
          if (!capturedTokenId) {
            const tokens = await paymentAdapter.fetchTokensForCustomer(targetCustomerId);
            if (tokens && tokens.length > 0) {
              capturedTokenId = tokens[0].token_id;
              capturedMethod = tokens[0].method || "card";
              capturedMaxAmount = tokens[0].max_amount || 10000000;
            }
          }

          if (capturedTokenId) {
            if (recurringTokenStore) {
              recurringTokenStore.save({
                customer_id: targetCustomerId,
                token_id: capturedTokenId,
                method: (capturedMethod === "card" ? "card" : "upi") as "upi" | "card",
                max_amount: capturedMaxAmount,
                email: orderConfirmedTxn.payment?.customer_email,
                contact: orderConfirmedTxn.payment?.customer_contact,
                created_at: new Date().toISOString(),
              });
            }
            if (authGuard && typeof authGuard.getSessionStore === "function") {
              const sessionStore = authGuard.getSessionStore();
              const activeSession = sessionStore.getActiveSession();
              if (activeSession) {
                sessionStore.attachCustomerId(activeSession.session_id, targetCustomerId);
              }
            }
            orderConfirmedTxn.token_captured = true;
            if (orderConfirmedTxn.payment) {
              orderConfirmedTxn.payment.recurring_token_id = capturedTokenId;
              orderConfirmedTxn.payment.token_captured = true;
            }

            auditLedger.append(
              recurringTokenCapturedEvent(txnId, {
                customer_id: targetCustomerId,
                token_id: capturedTokenId,
                method: capturedMethod,
                max_amount: capturedMaxAmount,
              })
            );

            capturedTokenInfo = {
              recurring_token: capturedTokenId,
              customer_id: targetCustomerId,
            };
          }
        } catch (tokenErr) {
          console.warn("[Transaction] Token capture attempt failed:", tokenErr);
        }
      }

      const updatedTxn = txnManager.get(txnId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transaction_id: updatedTxn.transaction_id,
                state: updatedTxn.state,
                created_at: updatedTxn.created_at,
                agent_claim: updatedTxn.agent_claim,
                checkout: updatedTxn.merchant_verified
                  ? {
                    checkout_id: updatedTxn.merchant_verified.checkout_id,
                    sku: updatedTxn.merchant_verified.sku,
                    total: updatedTxn.merchant_verified.total,
                  }
                  : null,
                payment: updatedTxn.payment
                  ? {
                    status: updatedTxn.payment.payment_status,
                    payment_id: updatedTxn.payment.razorpay_payment_id,
                    payment_method: updatedTxn.payment.payment_method,
                    payment_url: updatedTxn.payment.payment_link_url,
                    one_time_payment_url: updatedTxn.payment.one_time_payment_url || updatedTxn.payment.payment_link_url,
                    autopay_mandate_url: updatedTxn.payment.autopay_mandate_url,
                    ...(updatedTxn.payment.payment_status === "pending"
                      ? {
                        instructions_for_agent:
                          "CRITICAL: Do NOT attempt to visit, open, or automate these payment links yourself via browser tools. You MUST present them directly to the human user in your response so they can complete payment in their own browser.",
                      }
                      : {}),
                  }
                  : updatedTxn.state === TransactionState.MANDATE_EVALUATED && mandateStore && !updatedTxn.authorization_reference
                    ? (() => {
                      const challenge = mandateStore.getConsentChallengeByTransaction(txnId);
                      return challenge
                        ? {
                          status: "consent_required",
                          consent_url: challenge.consent_url,
                          challenge_id: challenge.challenge_id,
                          expires_at: challenge.expires_at,
                          instructions_for_agent:
                            "CRITICAL: Do NOT attempt to open, visit, or automate this consent_url yourself using browser tools. You MUST present this link directly to the human user in your response so they can review, approve, or reject the purchase mandate in their own browser.",
                          message:
                            "A saved recurring payment token exists. Do NOT open this URL yourself. Present consent_url directly to the human user to sign or reject the mandate, then re-poll get_transaction_status.",
                        }
                        : null;
                    })()
                    : updatedTxn.state === TransactionState.MANDATE_EVALUATED && updatedTxn.authorization_reference
                      ? {
                        status: "consent_approved",
                        message: "Consent has been granted by the user. Payment progression in progress.",
                      }
                      : null,
                order: updatedTxn.merchant_order ?? null,
                ...(capturedTokenInfo || (updatedTxn.token_captured && updatedTxn.payment?.recurring_token_id)
                  ? {
                    autonomous_payment_available: true,
                    recurring_token: capturedTokenInfo?.recurring_token || updatedTxn.payment?.recurring_token_id,
                    customer_id: capturedTokenInfo?.customer_id || updatedTxn.customer_id,
                    message:
                      "Token registered. Future purchases at this merchant can be completed autonomously! For subsequent purchases, call prepare_purchase directly (do NOT invoke create_mandate) — the MCP server will automatically issue an AP2 consent challenge (consent_url) for the user to review and authorize the purchase, after which payment executes autonomously.",
                  }
                  : {}),
                ucp: projectUcpEnvelope(updatedTxn),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── get_transaction_audit ──────────────────────────────────────────────────
  server.tool(
    "get_transaction_audit",
    "Retrieve the complete, tamper-evident audit timeline and human-readable Decision Receipt for a transaction.",
    {
      transaction_id: z.string().describe("Transaction ID"),
    },
    async (params) => {
      const txnId = params.transaction_id;
      if (!txnManager.has(txnId)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Transaction "${txnId}" not found.` }),
            },
          ],
        };
      }

      const txn = txnManager.get(txnId);
      const events = auditLedger.getTransactionAudit(txnId);
      const chainVerification = auditLedger.verifyChain(txnId);
      const lastCheckpoint = auditLedger.getLastCheckpoint();
      const checkpointVerification = auditLedger.verifyCheckpoints();
      const receipt = generateDecisionReceipt(txn, events, chainVerification.valid, lastCheckpoint);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transaction_id: txnId,
                state: txn.state,
                event_count: events.length,
                hash_chain: {
                  valid: chainVerification.valid,
                  broken_at_event_id: chainVerification.broken_at_event_id,
                },
                last_checkpoint: lastCheckpoint ?? null,
                checkpoints_valid: checkpointVerification.valid,
                timeline: events.map((e) => ({
                  event_id: e.event_id,
                  event_type: e.event_type,
                  timestamp: e.timestamp,
                  actor: e.actor,
                  summary: e.state_transition
                    ? `${e.state_transition.from} → ${e.state_transition.to} (${e.state_transition.trigger})`
                    : e.policy?.decision ?? e.request?.tool ?? undefined,
                })),
                decision_receipt: receipt,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── cancel_transaction ───────────────────────────────────────────────────
  server.tool(
    "cancel_transaction",
    "Cancel a transaction. Before payment: releases the hold (no money moves). After order confirmation: " +
    "calls the merchant cancel operation (if supported) and initiates a full refund of the captured payment.",
    {
      transaction_id: z.string().describe("Transaction ID to cancel"),
      reason: z.string().optional().describe("Buyer/agent-stated cancellation reason (audit metadata only)"),
      session_id: z.string().optional().describe("Optional active session ID for user-authenticated cancellation"),
    },
    async (params) => {
      const txnId = params.transaction_id;
      if (!txnManager.has(txnId)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Transaction "${txnId}" not found.` }),
            },
          ],
        };
      }

      const txn = txnManager.get(txnId);
      auditLedger.append(toolInvokedEvent(txnId, "cancel_transaction", params));

      // 1. Policy gate (state legality via TransactionStateGate)
      const decision = policyEngine.evaluate(txn, "CANCEL", { reason: params.reason });
      txnManager.bindPolicyDecision(txn.transaction_id, decision);
      auditLedger.append(policyEvaluatedEvent(txn.transaction_id, decision));

      if (decision.decision === "DENY") {
        auditLedger.append(toolFailedEvent(txnId, "cancel_transaction", "Policy rejected cancellation"));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  transaction_id: txnId,
                  state: txn.state,
                  error: "Cancellation rejected by policy gates.",
                  policy_decision: decision,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // 2. Post-confirmation: refund the captured payment, then cancel merchant-side
      if (txn.state === TransactionState.ORDER_CONFIRMED && txn.payment?.payment_status === "captured") {
        const remainingToRefund =
          (txn.merchant_verified?.total.amount ?? 0) - (txn.payment?.refunded_amount ?? 0);
        const refundResult = await paymentAdapter.refundPayment(
          txn.payment.razorpay_payment_id!,
          remainingToRefund > 0
            ? { amount: remainingToRefund, currency: txn.merchant_verified!.total.currency }
            : undefined,
          { transaction_id: txn.transaction_id, reason: params.reason ?? "buyer_cancellation" }
        );

        txnManager.bindRefund(txn.transaction_id, {
          refund_id: refundResult.refund_id,
          amount: refundResult.amount,
          status: refundResult.status === "processed" ? "processed" : "initiated",
          reason: params.reason ?? "buyer_cancellation",
          created_at: new Date().toISOString(),
          processed_at: refundResult.status === "processed" ? new Date().toISOString() : undefined,
        });

        // Try merchant-side cancel if operation exists
        if (connector.getManifest().operations.cancel_order && txn.merchant_order) {
          try {
            let sessionToken: string | undefined = undefined;
            if (authGuard) {
              const authResult = await authGuard.check("cancel_order", params.session_id);
              sessionToken = authResult.access_token;
            }
            const cancelled = sessionToken
              ? await connector.cancelOrder(txn.merchant_order.order_id, params.reason, sessionToken)
              : await connector.cancelOrder(txn.merchant_order.order_id, params.reason);
            txnManager.bindOrder(txn.transaction_id, cancelled);
          } catch (err: unknown) {
            console.warn(`[MerchantMCP] Merchant cancel_order warning: ${(err as Error).message}`);
          }
        }

        // If refund settled instantly to "processed", advance to REFUNDED; otherwise REFUND_PENDING
        if (refundResult.status === "processed") {
          txnManager.transition(
            txn.transaction_id,
            TransactionState.REFUND_PENDING,
            `cancellation:${params.reason ?? "requested"}`
          );
          txnManager.transition(txn.transaction_id, TransactionState.REFUNDED, "refund_processed_instantly");
          auditLedger.append(
            refundProcessedEvent(txn.transaction_id, {
              refund_id: refundResult.refund_id,
              amount: refundResult.amount.amount,
              currency: refundResult.amount.currency,
            })
          );
        } else {
          txnManager.transition(
            txn.transaction_id,
            TransactionState.REFUND_PENDING,
            `cancellation:${params.reason ?? "requested"}`
          );
          auditLedger.append(refundInitiatedEvent(txn.transaction_id, refundResult));
        }

        auditLedger.append(
          transactionCancelledEvent(txn.transaction_id, params.reason, "refund_initiated")
        );
      } else {
        // 3. Pre-payment: pure state cancellation
        txnManager.transition(
          txn.transaction_id,
          TransactionState.CANCELLED,
          `buyer_cancelled:${params.reason ?? "requested"}`
        );
        auditLedger.append(transactionCancelledEvent(txn.transaction_id, params.reason, "no_money_moved"));
      }

      auditLedger.append(
        toolCompletedEvent(txnId, "cancel_transaction", { state: txnManager.get(txnId).state })
      );

      const updatedTxn = txnManager.get(txnId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transaction_id: updatedTxn.transaction_id,
                state: updatedTxn.state,
                message:
                  updatedTxn.state === TransactionState.REFUNDED
                    ? "Transaction cancelled and payment successfully refunded."
                    : updatedTxn.state === TransactionState.REFUND_PENDING
                      ? "Transaction cancellation accepted; refund initiated on Razorpay."
                      : "Transaction successfully cancelled before payment authorization.",
                refunds: updatedTxn.payment?.refunds ?? [],
                refunded_amount: updatedTxn.payment?.refunded_amount ?? 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── request_refund ───────────────────────────────────────────────────────
  server.tool(
    "request_refund",
    "Request a refund on a confirmed, captured transaction. Defaults to the full refundable remainder. " +
    "Returns REFUND_PENDING; the Razorpay refund.processed webhook moves it to REFUNDED.",
    {
      transaction_id: z.string().describe("Transaction ID"),
      amount: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Refund amount in currency sub-units (paise). Omit for full remaining refund."),
      reason: z.string().optional().describe("Refund reason (audit metadata only)"),
    },
    async (params) => {
      const txnId = params.transaction_id;
      if (!txnManager.has(txnId)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `Transaction "${txnId}" not found.` }),
            },
          ],
        };
      }

      const txn = txnManager.get(txnId);
      auditLedger.append(toolInvokedEvent(txnId, "request_refund", params));

      // 1. Policy gate — REQUEST_REFUND is a money action (RefundBoundsGate + StateGate + IdempotencyGate)
      const decision = policyEngine.evaluate(txn, "REQUEST_REFUND", {
        requested_amount: params.amount,
        requested_currency: txn.merchant_verified?.total.currency,
      });
      txnManager.bindPolicyDecision(txn.transaction_id, decision);
      auditLedger.append(refundRequestedEvent(txn.transaction_id, params.amount, params.reason));

      if (decision.decision === "DENY") {
        auditLedger.append(toolFailedEvent(txnId, "request_refund", "Policy rejected refund request"));
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  transaction_id: txnId,
                  state: txn.state,
                  error: "Refund request rejected by policy gates.",
                  policy_decision: decision,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // 2. Execute on the Razorpay rail; notes carry txn id for webhook reconciliation
      const refundSubUnits =
        params.amount ??
        Math.max(
          0,
          (txn.merchant_verified?.total.amount ?? 0) - (txn.payment?.refunded_amount ?? 0)
        );

      const refund = await paymentAdapter.refundPayment(
        txn.payment!.razorpay_payment_id!,
        { amount: refundSubUnits, currency: txn.merchant_verified!.total.currency },
        { transaction_id: txn.transaction_id, reason: params.reason ?? "buyer_requested_refund" }
      );

      // 3. Bind + transition
      txnManager.bindRefund(txn.transaction_id, {
        refund_id: refund.refund_id,
        amount: refund.amount,
        status: refund.status === "processed" ? "processed" : "initiated",
        reason: params.reason,
        created_at: new Date().toISOString(),
        processed_at: refund.status === "processed" ? new Date().toISOString() : undefined,
      });

      if (refund.status === "processed") {
        txnManager.transition(
          txn.transaction_id,
          TransactionState.REFUND_PENDING,
          "refund_initiated_via_razorpay"
        );
        txnManager.transition(txn.transaction_id, TransactionState.REFUNDED, "refund_settled_instantly");
        auditLedger.append(
          refundProcessedEvent(txn.transaction_id, {
            refund_id: refund.refund_id,
            amount: refund.amount.amount,
            currency: refund.amount.currency,
          })
        );
      } else {
        txnManager.transition(
          txn.transaction_id,
          TransactionState.REFUND_PENDING,
          "refund_initiated_via_razorpay"
        );
        auditLedger.append(refundInitiatedEvent(txn.transaction_id, refund));
      }

      auditLedger.append(toolCompletedEvent(txnId, "request_refund", { refund_id: refund.refund_id }));

      const updatedTxn = txnManager.get(txnId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transaction_id: updatedTxn.transaction_id,
                state: updatedTxn.state,
                refund: {
                  refund_id: refund.refund_id,
                  amount: refund.amount,
                  status: refund.status,
                },
                refunded_amount: updatedTxn.payment?.refunded_amount ?? 0,
                note:
                  refund.status === "processed"
                    ? "Refund processed successfully."
                    : "Refund initiated; awaiting webhook confirmation.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── add_to_cart ────────────────────────────────────────────────────────────
  server.tool(
    "add_to_cart",
    "Add an item to the shopping cart. For merchants with multi-item carts. " +
    "Omit cart_id for the first item to create a new cart.",
    {
      cart_id: z.string().optional().describe("Existing cart ID, or omit to create new cart"),
      product_id: z.string().describe("Product/offer SKU or ID to add to cart"),
      quantity: z.number().int().positive().default(1).describe("Quantity of items"),
      variant: z.record(z.string()).optional().describe("Selected variant options"),
      session_id: z.string().optional().describe("Optional active session ID for user-authenticated cart"),
    },
    async (params) => {
      const manifest = connector.getManifest();
      if (manifest.transaction?.cart?.model !== "multi_item") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "This merchant uses single-item checkout. Use prepare_purchase directly.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("add_to_cart", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      try {
        const result = sessionToken
          ? await connector.addToCart(
            params.cart_id ?? null,
            params.product_id,
            params.quantity,
            params.variant,
            sessionToken
          )
          : await connector.addToCart(
            params.cart_id ?? null,
            params.product_id,
            params.quantity,
            params.variant
          );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // ─── get_cart ───────────────────────────────────────────────────────────────
  server.tool(
    "get_cart",
    "Retrieve the current contents and total of a multi-item shopping cart.",
    {
      cart_id: z.string().describe("The cart ID to inspect"),
      session_id: z.string().optional().describe("Optional active session ID for user-authenticated cart"),
    },
    async (params) => {
      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("get_cart", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      try {
        const result = sessionToken
          ? await connector.getCart(params.cart_id, sessionToken)
          : await connector.getCart(params.cart_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // ─── apply_coupon ───────────────────────────────────────────────────────────
  server.tool(
    "apply_coupon",
    "Apply a discount coupon or promotional code to an active checkout session.",
    {
      checkout_id: z.string().describe("Active checkout session ID"),
      coupon_code: z.string().describe("Promotional coupon code to apply"),
      session_id: z.string().optional().describe("Optional active session ID for user-authenticated coupon application"),
    },
    async (params) => {
      const manifest = connector.getManifest();
      if (!manifest.transaction?.coupons?.supported) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "This merchant does not support coupons.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("apply_coupon", params.session_id);
        if (!authResult.authorized && authResult.auth_required_response) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(authResult.auth_required_response, null, 2),
              },
            ],
          };
        }
        sessionToken = authResult.access_token;
      }

      try {
        const result = sessionToken
          ? await connector.applyCoupon(params.checkout_id, params.coupon_code, sessionToken)
          : await connector.applyCoupon(params.checkout_id, params.coupon_code);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // ─── get_delivery_options ───────────────────────────────────────────────────
  server.tool(
    "get_delivery_options",
    "Retrieve available delivery/shipping options and rates for the current checkout.",
    {
      checkout_id: z.string().describe("Active checkout session ID"),
      session_id: z.string().optional().describe("Optional active session ID"),
    },
    async (params) => {
      const manifest = connector.getManifest();
      if (!manifest.transaction?.delivery?.options_available) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "This merchant does not offer configurable delivery options.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("get_delivery_options", params.session_id);
        sessionToken = authResult.access_token;
      }

      try {
        const options = sessionToken
          ? await connector.getDeliveryOptions(params.checkout_id, sessionToken)
          : await connector.getDeliveryOptions(params.checkout_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ options }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // ─── select_delivery_option ─────────────────────────────────────────────────
  server.tool(
    "select_delivery_option",
    "Choose a shipping or delivery option for the order.",
    {
      checkout_id: z.string().describe("Active checkout session ID"),
      option_id: z.string().describe("Delivery option ID selected by the user/agent"),
      session_id: z.string().optional().describe("Optional active session ID"),
    },
    async (params) => {
      const manifest = connector.getManifest();
      if (!manifest.transaction?.delivery?.options_available) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "This merchant does not offer configurable delivery options.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      let sessionToken: string | undefined = undefined;
      if (authGuard) {
        const authResult = await authGuard.check("select_delivery_option", params.session_id);
        sessionToken = authResult.access_token;
      }

      try {
        const result = sessionToken
          ? await connector.selectDeliveryOption(params.checkout_id, params.option_id, sessionToken)
          : await connector.selectDeliveryOption(params.checkout_id, params.option_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );
}
