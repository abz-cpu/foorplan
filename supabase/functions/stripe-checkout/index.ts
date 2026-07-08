// Creates a Stripe Checkout Session (subscription mode) for the caller's org
// and returns its URL for the client to redirect to. Requires the
// STRIPE_SECRET_KEY and STRIPE_PRICE_ID secrets to be set on the Supabase
// project — with either missing this 500s and the client should keep
// whatever "billing not available" state it already shows.
import { CORS_HEADERS, getServiceRoleClient, jsonResponse, requireOrgMember } from '../_shared/auth.ts';
import { getStripeClient } from '../_shared/stripe.ts';

interface CheckoutBody {
  successUrl: string;
  cancelUrl: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { user, orgId } = await requireOrgMember(req);
    const { successUrl, cancelUrl } = (await req.json()) as CheckoutBody;
    if (!successUrl || !cancelUrl) throw new Error('successUrl and cancelUrl are required');

    const priceId = Deno.env.get('STRIPE_PRICE_ID');
    if (!priceId) throw new Error('STRIPE_PRICE_ID is not configured on this project');

    const stripe = getStripeClient();
    const serviceClient = getServiceRoleClient();

    const { data: existing } = await serviceClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { org_id: orgId },
      });
      customerId = customer.id;
      await serviceClient
        .from('subscriptions')
        .upsert({ org_id: orgId, stripe_customer_id: customerId }, { onConflict: 'org_id' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: orgId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return jsonResponse({ url: session.url });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
