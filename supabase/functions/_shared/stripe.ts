import Stripe from 'npm:stripe@17.4.0';

// Deno has no Node `http`/`https` modules, which Stripe's SDK defaults to —
// the fetch-based HTTP client is Stripe's own documented way to run their
// SDK on Deno/edge runtimes.
export function getStripeClient(): Stripe {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured on this project');
  return new Stripe(secretKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
}
