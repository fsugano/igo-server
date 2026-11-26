import type { PublicUser } from '@igo/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Account, api } from './api';
import { getSocket, resetSocket } from './socket';

interface AuthState {
  user: PublicUser | null;
  account: Account | null;
  setAccount(a: Account): void;
  loading: boolean;
  setUser(u: PublicUser | null): void;
  /** New details for the same signed-in user (no reconnect). */
  updateUser(u: PublicUser): void;
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

  // Rating and level after a game, nickname or picture changed in another tab.
  useEffect(() => {
    const s = getSocket();
    const onUpdated = (u: PublicUser) => setUserState((cur) => (cur && cur.id === u.id ? u : cur));
    s.on('user:updated', onUpdated);
    return () => {
      s.off('user:updated', onUpdated);
    };
  }, []);

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

  return <Ctx.Provider value={{ user, account, setAccount, loading, setUser, updateUser: setUserState, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
