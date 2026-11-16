import type { Conversation, DirectMessage, PublicUser } from '@igo/shared';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { call, getSocket } from './socket';

interface SocialState {
  /** Ids of the people I follow. */
  following: Set<string>;
  setFollow(userId: string, follow: boolean): Promise<string | null>;
  /** Ids of the people I have blocked. */
  blocked: Set<string>;
  setBlock(userId: string, block: boolean): Promise<string | null>;
  conversations: Conversation[];
  unread: number;
  refreshConversations(): void;
  /** Called for each message to or from me. */
  onMessage(fn: (m: DirectMessage, from: PublicUser) => void): () => void;
}

const Ctx = createContext<SocialState | null>(null);

/** Follows and the list of conversations, for the signed-in user. */
export function SocialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const listeners = useRef(new Set<(m: DirectMessage, from: PublicUser) => void>());

  const refreshConversations = useCallback(() => {
    void call<{ conversations: Conversation[] }>('dm:conversations').then((r) => {
      if (r.ok) setConversations(r.conversations);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setFollowing(new Set());
      setBlocked(new Set());
      setConversations([]);
      return;
    }
    const s = getSocket();
    const load = () => {
      void call<{ ids: string[] }>('follow:list').then((r) => r.ok && setFollowing(new Set(r.ids)));
      void call<{ ids: string[] }>('block:list').then((r) => r.ok && setBlocked(new Set(r.ids)));
      refreshConversations();
    };
    const onDm = (m: DirectMessage, from: PublicUser) => {
      listeners.current.forEach((fn) => fn(m, from));
      refreshConversations();
    };
    load();
    s.on('connect', load);
    s.on('dm:message', onDm);
    return () => {
      s.off('connect', load);
      s.off('dm:message', onDm);
    };
  }, [user?.id, refreshConversations]);

  const setFollow = async (userId: string, follow: boolean) => {
    const r = await call('follow:set', userId, follow);
    if (!r.ok) return r.error;
    setFollowing((f) => {
      const next = new Set(f);
      if (follow) next.add(userId);
      else next.delete(userId);
      return next;
    });
    return null;
  };

  const setBlock = async (userId: string, block: boolean) => {
    const r = await call('block:set', userId, block);
    if (!r.ok) return r.error;
    const change = (s: Set<string>, add: boolean) => {
      const next = new Set(s);
      if (add) next.add(userId);
      else next.delete(userId);
      return next;
    };
    setBlocked((b) => change(b, block));
    // Blocking ends the follow.
    if (block) setFollowing((f) => change(f, false));
    return null;
  };

  const onMessage = (fn: (m: DirectMessage, from: PublicUser) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  };

  const shown = conversations.filter((c) => !blocked.has(c.user.id));
  const unread = shown.reduce((n, c) => n + c.unread, 0);
  return (
    <Ctx.Provider
      value={{ following, setFollow, blocked, setBlock, conversations: shown, unread, refreshConversations, onMessage }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSocial(): SocialState {
  const s = useContext(Ctx);
  if (!s) throw new Error('SocialProvider missing');
  return s;
}
