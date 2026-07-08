// Creates a Stripe Billing Portal session so a subscribed org can manage or
// cancel their plan without any custom UI. Returns the portal URL to
// redirect to; errors if the org has never checked out (no customer yet).
import { CORS_HEADERS, jsonResponse, requireOrgMember } from '../_shared/auth.ts';
import { getStripeClient } from '../_shared/stripe.ts';

interface PortalBody {
  returnUrl: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  try {
    const { orgId, anonClient } = await requireOrgMember(req);
    const { returnUrl } = (await req.json()) as PortalBody;
    if (!returnUrl) throw new Error('returnUrl is required');

    // RLS already scopes this select to the caller's own org.
    const { data: sub, error } = await anonClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !sub?.stripe_customer_id) {
      throw new Error('No billing account yet — start a checkout first');
    }

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id as string,
      return_url: returnUrl,
    });

    return jsonResponse({ url: session.url });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
