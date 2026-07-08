import { useEffect, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const client: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true } }) : null;

/** Null when no Supabase project is configured — the app stays guest-only. */
export function getSupabaseClient(): SupabaseClient | null {
  return client;
}

export function isCloudConfigured(): boolean {
  return client !== null;
}

/** Live auth session, or `undefined` while the initial check is in flight. */
export function useAuthSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(
    client ? undefined : null,
  );

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      if (active) setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return session;
}

export async function signOut(): Promise<void> {
  await client?.auth.signOut();
}
