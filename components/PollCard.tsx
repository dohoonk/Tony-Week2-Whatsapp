import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { db } from '../firebase/config';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth } from '../firebase/config';

type Poll = {
  question: string;
  options: string[];
  votes?: Record<string, number>; // { uid: optionIndex }
  status?: 'open' | 'closed';
};

type PollCardProps = {
  pollId: string;
  chatId: string;
  members: string[];
};

export default function PollCard({ pollId, chatId, members }: PollCardProps) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const ref = doc(db, 'polls', pollId);
    const unsub = onSnapshot(ref, (snap) => {
      setPoll((snap.data() as any) || null);
      setLoading(false);
    });
    return () => unsub();
  }, [pollId]);

  const { counts, total, myVote } = useMemo(() => {
    const votes = (poll?.votes || {}) as Record<string, number>;
    const numOptions = poll?.options?.length || 0;
    const c = new Array(Math.max(numOptions, 0)).fill(0) as number[];
    Object.entries(votes).forEach(([, idx]) => {
      if (typeof idx === 'number' && idx >= 0 && idx < c.length) c[idx] += 1;
    });
    const uid = auth.currentUser?.uid || '';
    return { counts: c, total: c.reduce((a, b) => a + b, 0), myVote: votes[uid] };
  }, [poll]);

  const onVote = async (optionIndex: number) => {
    if (!poll || poll.status === 'closed') return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'polls', pollId);
    try {
      await updateDoc(ref, { [`votes.${uid}`]: optionIndex } as any);
    } catch {}
  };

  // Auto-close when all members voted, and post result into chat
  useEffect(() => {
    if (!poll || poll.status === 'closed') return;
    const votes = poll.votes || {};
    const numVoters = Object.keys(votes).length;
    const totalMembers = (members || []).length;
    if (totalMembers > 0 && numVoters >= totalMembers) {
      (async () => {
        try {
          // Close poll
          await updateDoc(doc(db, 'polls', pollId), { status: 'closed' });
          // Compute result
          const counts = new Array(poll.options.length).fill(0);
          Object.values(votes).forEach((idx) => {
            if (typeof idx === 'number' && idx >= 0 && idx < counts.length) counts[idx] += 1;
          });
          const max = Math.max(...counts);
          const winningIdx = counts.findIndex((c) => c === max);
          const winner = poll.options[winningIdx];
          const msg = `Poll closed: ${poll.question}\nResult: ${winner} (${max}/${numVoters})`;
          await updateDoc(doc(db, 'chats', chatId), { lastMessage: msg, lastMessageAt: Date.now() });
          // Post summary message
          const { collection, addDoc } = await import('firebase/firestore');
          await addDoc(collection(db, 'chats', chatId, 'messages'), {
            senderId: 'ai',
            text: msg,
            imageUrl: null,
            timestamp: Date.now(),
            type: 'ai_response',
            visibility: 'shared',
            relatedFeature: 'poll_result',
            relatedId: pollId,
            createdBy: auth.currentUser?.uid || 'system',
          } as any);
        } catch {}
      })();
    }
  }, [poll, members, pollId, chatId]);

  if (loading || !poll) {
    return (
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6' }}>
        <Text style={{ color: '#6B7280' }}>Loading poll…</Text>
      </View>
    );
  }

  return (
    <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', gap: 8 }}>
      <Text style={{ fontWeight: '600' }}>Poll: {poll.question}</Text>
      {poll.options?.map((opt, idx) => {
        const count = counts[idx] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isMine = myVote === idx;
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => onVote(idx)}
            disabled={poll.status === 'closed'}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 8,
              backgroundColor: isMine ? '#DBEAFE' : '#FFFFFF',
              borderWidth: 1,
              borderColor: '#E5E7EB',
              marginTop: 4,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ flexShrink: 1 }}>{opt}</Text>
              <Text style={{ color: '#6B7280' }}>{count} {pct ? `(${pct}%)` : ''}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={{ color: '#6B7280', marginTop: 6 }}>{total} vote{total === 1 ? '' : 's'}</Text>
    </View>
  );
}


