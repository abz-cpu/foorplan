import { getSupabaseClient } from './supabase';

async function invokeRedirect(functionName: string, body: Record<string, string>): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Cloud sync is not configured');
  const { data, error } = await client.functions.invoke(functionName, { body });
  if (error) throw error;
  if (typeof data?.url !== 'string') throw new Error('No checkout URL returned');
  window.location.href = data.url;
}

/** Redirects to a Stripe Checkout session for the caller's org. */
export function startCheckout(): Promise<void> {
  return invokeRedirect('stripe-checkout', {
    successUrl: `${window.location.origin}/account?checkout=success`,
    cancelUrl: `${window.location.origin}/account?checkout=cancelled`,
  });
}

/** Redirects to the Stripe Billing Portal for the caller's org. */
export function openBillingPortal(): Promise<void> {
  return invokeRedirect('stripe-portal', {
    returnUrl: `${window.location.origin}/account`,
  });
}
