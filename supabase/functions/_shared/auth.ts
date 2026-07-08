import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.4';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

/** Verifies the caller's JWT and returns the user + their org id, or throws. */
export async function requireOrgMember(
  req: Request,
): Promise<{ user: User; orgId: string; anonClient: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('Missing Authorization header');

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: membership, error: memberError } = await anonClient
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (memberError || !membership) throw new Error('No organisation found for this user');

  return { user, orgId: membership.org_id as string, anonClient };
}

/** Service-role client — bypasses RLS. Only for server-authoritative writes
 * (billing status must never be client-writable). */
export function getServiceRoleClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}
