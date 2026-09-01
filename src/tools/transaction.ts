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
import { RazorpayAdapter } from "../payment/razorpay.js";
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
} from "../audit/events.js";
import { AuthGuard } from "../auth/auth-guard.js";

export function registerTransactionTools(
  server: McpServer,
  connector: ConnectorRuntime,
  txnManager: TransactionManager,
  policyEngine: PolicyEngine,
  paymentAdapter: RazorpayAdapter,
  auditLedger: AuditLedger,
  mandateStore?: MandateStore,
  authGuard?: AuthGuard
): void {
  // ─── prepare_purchase ───────────────────────────────────────────────────────
  server.tool(
    "prepare_purchase",
    "Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and generates a hosted payment link.\n\n" +
    "AGENT INSTRUCTION: Always invoke this tool directly whenever the user asks to buy or purchase a product. You do NOT need a pre-existing session_id to call this tool. If the merchant requires user authentication, this tool will automatically return a response with status 'auth_required' containing the 'authorization_url' for the human user to log in. Provide that link to the user, then call check_auth_status or retry prepare_purchase once they log in.",
    {
      product_id: z.string().describe("The product/offer ID to purchase"),
      quantity: z.number().int().positive().default(1).describe("Quantity to purchase"),
      variant: z.record(z.string()).optional().describe("Optional variant selections, e.g. { color: 'black', size: '10' }"),
      customer_data: z.record(z.unknown()).optional().describe("Customer contact/shipping details if required by merchant"),
      selection_reason: z.string().describe("Explanation of why the agent chose this item (recorded for audit trail)"),
      authorization_reference: z.string().optional().describe("Signed Intent Mandate or Payment Mandate authorization reference (AP2)"),
      session_id: z.string().optional().describe("Optional active session ID if already authenticated. Omit if no session yet."),
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

      // 1. Create Transaction in CREATED state with MCP-generated ID
      const txn = txnManager.create({
        product_id: params.product_id,
        quantity: params.quantity,
        variant: params.variant,
        selection_reason: params.selection_reason,
      });
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
          } else {
            // Mode B: JIT Human Consent Required
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
                          message:
                            "Explicit user approval required. Present consent_url to the user and re-poll get_transaction_status.",
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
        const policyDecision = policyEngine.evaluate(txnManager.get(txnId), "CREATE_PAYMENT", {
          authorization_reference: effectiveAuthRef,
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

        // 5. Create Payment Order with Razorpay
        const orderResult = await paymentAdapter.createOrder({
          amount: checkout.total,
          receipt: txnId,
          notes: {
            transaction_id: txnId,
            product_id: params.product_id,
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

        // 6. Generate Payment Link with Razorpay
        const linkResult = await paymentAdapter.createPaymentLink({
          amount: checkout.total,
          description: `Purchase: ${offer.title} (x${params.quantity})`,
          reference_id: txnId,
          order_id: orderResult.order_id,
          manifestPaymentConfig: manifest.payment,
        });

        auditLedger.append(
          paymentLinkGeneratedEvent(txnId, {
            payment_link_id: linkResult.payment_link_id,
            short_url: linkResult.short_url,
            amount: checkout.total.amount,
          })
        );

        // 7. Generate Checkout SDK Session info
        const checkoutSession = await paymentAdapter.createCheckoutSession({
          order_id: orderResult.order_id,
          amount: checkout.total,
          merchant_name: connector.getManifest().merchant.name,
          description: `Purchase: ${offer.title} (x${params.quantity})`,
        });

        // 8. Bind Payment Data and Transition to PAYMENT_PENDING
        txnManager.bindPayment(txnId, {
          provider: "razorpay",
          razorpay_order_id: orderResult.order_id,
          payment_link_id: linkResult.payment_link_id,
          payment_link_url: linkResult.short_url,
          payment_status: "pending",
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
            payment_url: linkResult.short_url,
            razorpay_order_id: orderResult.order_id,
            methods: {
              payment_link: {
                url: linkResult.short_url,
                description: "Open this hosted URL in browser to complete payment",
              },
              checkout_sdk: {
                razorpay_key_id: checkoutSession.razorpay_key_id,
                razorpay_order_id: checkoutSession.razorpay_order_id,
                amount: checkoutSession.amount.amount,
                currency: checkoutSession.currency,
                merchant_name: checkoutSession.merchant_name,
                description: checkoutSession.description,
                instructions: "Use these parameters to render Razorpay Standard Checkout in a web/native host",
              },
            },
            message: "Choose payment_link (open URL) or checkout_sdk (render native Razorpay Checkout).",
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
    "Poll or retrieve the real-time status of an ongoing transaction. Automatically finalizes order confirmation when payment authorization is received.",
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
          const policyDecision = policyEngine.evaluate(txn, "CREATE_PAYMENT", {
            authorization_reference: txn.authorization_reference,
          });
          txnManager.bindPolicyDecision(txnId, policyDecision);
          auditLedger.append(policyEvaluatedEvent(txnId, policyDecision));

          if (policyDecision.decision === "ALLOW") {
            const orderResult = await paymentAdapter.createOrder({
              amount: checkout.total,
              receipt: txnId,
              notes: { transaction_id: txnId, product_id: txn.agent_claim.product_id },
            });
            auditLedger.append(
              paymentOrderCreatedEvent(txnId, {
                order_id: orderResult.order_id,
                amount: checkout.total.amount,
                currency: checkout.total.currency,
              })
            );

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
        } catch (err: unknown) {
          console.error("JIT mandate progression error:", err);
        }
      }

      // Active Razorpay Polling: If payment is pending, poll Razorpay to verify if user completed payment
      if (txn.state === TransactionState.PAYMENT_PENDING && txn.payment) {
        try {
          let verifiedPayment: { payment_id: string; status: string } | null = null;
          if (txn.payment.razorpay_order_id) {
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
                    payment_url: updatedTxn.payment.payment_link_url,
                  }
                  : null,
                order: updatedTxn.merchant_order ?? null,
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
