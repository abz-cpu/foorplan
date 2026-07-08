import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud } from 'lucide-react';
import { createSupabaseRepositories, ensureOrgForCurrentUser, adoptGuestDataToAccount } from '@floorplan/data';
import { BrandMark, Button, TextInput, useToast } from '@floorplan/ui';
import { guestRepos } from '../lib/repos';
import { getSupabaseClient, isCloudConfigured, useAuthSession, signOut } from '../lib/supabase';

type Mode = 'sign-in' | 'sign-up';

export default function AccountPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const client = getSupabaseClient();
  const session = useAuthSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isCloudConfigured() || !client) {
    return (
      <div className="mx-auto max-w-[480px] px-6 py-16 text-center">
        <BrandMark size={36} />
        <h1 className="mt-4 text-lg font-bold tracking-tight">Cloud sync isn't set up yet</h1>
        <p className="mt-2 text-[13.5px] text-ink-faint">
          This deployment has no Supabase project configured, so Floor Plan Studio runs in
          guest mode only — everything stays on this device. Set{' '}
          <code className="rounded bg-shell px-1 py-0.5 text-xs">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-shell px-1 py-0.5 text-xs">VITE_SUPABASE_ANON_KEY</code> to
          enable accounts.
        </p>
        <Button variant="outline" className="mt-5" onClick={() => navigate('/')}>
          <ArrowLeft size={15} /> Back to properties
        </Button>
      </div>
    );
  }

  const handleAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: authError } =
        mode === 'sign-in'
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({ email, password });
      if (authError) throw authError;
      if (mode === 'sign-up') toast('Check your inbox to confirm your account');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError(null);
    const { error: authError } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
  };

  const handleImportGuestData = async () => {
    if (!session) return;
    setImporting(true);
    try {
      const orgId = await ensureOrgForCurrentUser(client);
      const cloudRepos = createSupabaseRepositories(client, orgId);
      const { properties, floors } = await adoptGuestDataToAccount(guestRepos, cloudRepos);
      toast(`Imported ${properties} propert${properties === 1 ? 'y' : 'ies'}, ${floors} floor${floors === 1 ? '' : 's'}`);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (session) {
    return (
      <div className="mx-auto max-w-[480px] px-6 py-16">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-6">
          <ArrowLeft size={14} /> Back
        </Button>
        <BrandMark size={36} />
        <h1 className="mt-4 text-lg font-bold tracking-tight">Signed in</h1>
        <p className="mt-1 text-[13.5px] text-ink-faint">{session.user.email}</p>

        <div className="mt-6 rounded-[14px] border border-line bg-white p-5">
          <h2 className="text-[13.5px] font-semibold text-ink-mid">Import your guest data</h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            Copies every property and floor plan saved on this device into your cloud account.
            Nothing local is deleted.
          </p>
          <Button className="mt-3.5" onClick={handleImportGuestData} disabled={importing}>
            <Cloud size={15} /> {importing ? 'Importing…' : 'Import guest data'}
          </Button>
        </div>

        {error && <p className="mt-4 text-[13px] text-red-600">{error}</p>}

        <Button variant="outline" className="mt-6" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[420px] px-6 py-16">
      <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-6">
        <ArrowLeft size={14} /> Back
      </Button>
      <BrandMark size={36} />
      <h1 className="mt-4 text-lg font-bold tracking-tight">
        {mode === 'sign-in' ? 'Sign in' : 'Create an account'}
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-faint">
        Sync your properties and floor plans across devices.
      </p>

      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void handleAuth();
        }}
      >
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Email</label>
          <TextInput
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink-mid">Password</label>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <Button type="submit" disabled={busy || !email || !password} className="mt-1 shadow-cta">
          {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        </Button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        <Button variant="outline" onClick={() => void handleOAuth('google')}>
          Continue with Google
        </Button>
        <Button variant="outline" onClick={() => void handleOAuth('apple')}>
          Continue with Apple
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        className="mt-5 text-[13px] font-medium text-brand hover:underline"
      >
        {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
