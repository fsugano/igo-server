import type { PublicUser } from '@igo/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { resetSocket } from './socket';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  setUser(u: PublicUser | null): void;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await api.me().catch(() => ({ user: null }));
    setUserState(r.user);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setUser = (u: PublicUser | null) => {
    setUserState(u);
    resetSocket();
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, setUser, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
