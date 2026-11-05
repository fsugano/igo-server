import type { PublicUser } from '@igo/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Account, api } from './api';
import { resetSocket } from './socket';

interface AuthState {
  user: PublicUser | null;
  account: Account | null;
  setAccount(a: Account): void;
  loading: boolean;
  setUser(u: PublicUser | null): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await api.me().catch(() => ({ user: null, account: null }));
    setUserState(r.user);
    setAccount(r.account);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setUser = (u: PublicUser | null) => {
    setUserState(u);
    resetSocket();
    // The role and settings come with /api/me.
    if (u) void refresh();
    else setAccount(null);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, account, setAccount, loading, setUser, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
