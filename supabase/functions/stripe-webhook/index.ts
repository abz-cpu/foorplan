// Stripe webhook receiver. Configure this function's URL as an endpoint in
// the Stripe Dashboard (or `stripe listen` for local testing) subscribed to:
// checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted. Requires STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET secrets. All writes use the service-role client —
// there is no caller JWT here, Stripe is calling us directly, and billing
// status must never be reachable through anything but this verified path.
import Stripe from 'npm:stripe@17.4.0';
import { getServiceRoleClient } from '../_shared/auth.ts';
import { getStripeClient } from '../_shared/stripe.ts';

async function upsertFromSubscription(
  db: ReturnType<typeof getServiceRoleClient>,
  orgId: string,
  sub: Stripe.Subscription,
) {
  const planTier = sub.status === 'active' || sub.status === 'trialing' ? 'pro' : 'free';
  await db.from('subscriptions').upsert(
    {
      org_id: orgId,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      plan_tier: planTier,
      status: sub.status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    },
    { onConflict: 'org_id' },
  );
}

async function findOrgIdByCustomerId(
  db: ReturnType<typeof getServiceRoleClient>,
  customerId: string,
): Promise<string | null> {
  const { data } = await db
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !webhookSecret) {
    return new Response('Webhook not configured', { status: 500 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Signature verification failed: ${err instanceof Error ? err.message : err}`, {
      status: 400,
    });
  }

  const db = getServiceRoleClient();
  const stripe = getStripeClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.client_reference_id;
        if (orgId && session.subscription) {
          const subId =
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertFromSubscription(db, orgId, sub);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const orgId = await findOrgIdByCustomerId(db, customerId);
        if (orgId) await upsertFromSubscription(db, orgId, sub);
        break;
      }
      default:
        // Unhandled event type — acknowledge receipt, no action needed.
        break;
    }
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Unknown error', { status: 500 });
  }
});
