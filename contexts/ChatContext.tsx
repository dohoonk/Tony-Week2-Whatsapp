import React, { createContext, useContext, useMemo, useState } from 'react';

export type ChatContextValue = {
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

type ChatProviderProps = {
  children: React.ReactNode;
};

export function ChatProvider({ children }: ChatProviderProps) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const value = useMemo<ChatContextValue>(() => ({ activeChatId, setActiveChatId }), [activeChatId]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within <ChatProvider>');
  return ctx;
}


