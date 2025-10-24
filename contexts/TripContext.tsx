import React, { createContext, useContext, useMemo, useState } from 'react';

export type TripContextValue = {
  activeTripId: string | null;
  setActiveTripId: (id: string | null) => void;
};

const TripContext = createContext<TripContextValue | undefined>(undefined);

type TripProviderProps = {
  children: React.ReactNode;
};

export function TripProvider({ children }: TripProviderProps) {
  const [activeTripId, setActiveTripId] = useState<string | null>(null);

  const value = useMemo<TripContextValue>(() => ({ activeTripId, setActiveTripId }), [activeTripId]);

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used within <TripProvider>');
  return ctx;
}


