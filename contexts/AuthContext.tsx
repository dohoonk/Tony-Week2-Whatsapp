import React, { createContext, useContext, useMemo } from 'react';
import { auth } from '../firebase/config';

export type AuthContextValue = {
  user: any | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
  user: any | null;
  children: React.ReactNode;
};

export function AuthProvider({ user, children }: AuthProviderProps) {
  const value = useMemo<AuthContextValue>(() => ({
    user,
    getIdToken: async (forceRefresh?: boolean) => {
      try {
        // Prefer provided user, fall back to Firebase auth current
        const token = await (user ?? auth.currentUser)?.getIdToken?.(!!forceRefresh);
        return token ?? null;
      } catch {
        return null;
      }
    },
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}


