import { Link, useNavigate } from 'react-router-dom';
import { Cloud, CloudOff, Plus } from 'lucide-react';
import { BrandMark, Button } from '@floorplan/ui';
import { isCloudConfigured, useAuthSession } from '../lib/supabase';

function AccountPill() {
  const navigate = useNavigate();
  const session = useAuthSession();

  if (!isCloudConfigured()) {
    return (
      <span
        className="flex items-center gap-2 rounded-full border border-line bg-shell px-3 py-1.5 text-xs font-semibold text-ink-soft"
        title="Plans are stored on this device. Cloud sync arrives with accounts."
      >
        <CloudOff size={13} />
        Working locally
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate('/account')}
      className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-shell px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-line-soft"
      title={session ? `Synced as ${session.user.email}` : 'Sign in to sync across devices'}
    >
      {session ? <Cloud size={13} className="text-brand" /> : <CloudOff size={13} />}
      {session ? 'Synced' : 'Sign in'}
    </button>
  );
}

function NavLink({ to, current, children }: { to: string; current: boolean; children: string }) {
  if (current) {
    return (
      <span className="rounded-lg bg-action-soft px-3 py-[7px] text-[13.5px] font-semibold text-brand">
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      className="rounded-lg px-3 py-[7px] text-[13.5px] font-medium text-ink-soft hover:bg-shell hover:text-ink"
    >
      {children}
    </Link>
  );
}

export function AppNav({
  onNewProperty,
  active = 'properties',
}: {
  onNewProperty?: () => void;
  active?: 'properties' | 'templates';
}) {
  const navigate = useNavigate();
  return (
    <nav className="sticky top-0 z-30 flex h-[60px] items-center border-b border-line bg-white px-4 md:px-6">
      <div className="flex items-center gap-2.5">
        <BrandMark size={32} />
        <div className="flex flex-col leading-[1.15]">
          <span className="text-[14.5px] font-bold tracking-tight">L&amp;D Energy</span>
          <span className="text-[10.5px] font-medium tracking-wide text-ink-faint">
            FLOOR PLAN STUDIO
          </span>
        </div>
      </div>

      <div className="ml-9 hidden items-center gap-1 md:flex">
        <NavLink to="/" current={active === 'properties'}>
          Properties
        </NavLink>
        <NavLink to="/templates" current={active === 'templates'}>
          Templates
        </NavLink>
        <span
          className="cursor-not-allowed rounded-lg px-3 py-[7px] text-[13.5px] font-medium text-ink-ghost"
          title="Coming soon"
        >
          Reports
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <Button onClick={onNewProperty ?? (() => navigate('/'))} className="shadow-cta">
          <Plus size={15} strokeWidth={2.4} />
          <span className="hidden sm:inline">New Property</span>
          <span className="sm:hidden">New</span>
        </Button>
        <div className="hidden h-6 w-px bg-line sm:block" />
        <span className="hidden sm:block">
          <AccountPill />
        </span>
      </div>
    </nav>
  );
}
