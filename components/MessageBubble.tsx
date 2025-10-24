import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';

type Sender = { displayName?: string | null; photoURL?: string | null } | null | undefined;

export type MessageBubbleProps = {
  text?: string | null;
  imageUrl?: string | null;
  isMine: boolean;
  isAI?: boolean;
  unreadCount?: number;
  timestamp?: number;
  sender?: Sender;
  isLastRead?: boolean;
  bubbleMax: number;
  onLongPress?: () => void;
};

export default function MessageBubble({
  text,
  imageUrl,
  isMine,
  isAI,
  unreadCount = 0,
  timestamp,
  sender,
  isLastRead,
  bubbleMax,
  onLongPress,
}: MessageBubbleProps) {
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

  if (isAI) {
    return (
      <View style={{ marginBottom: 8, alignSelf: 'flex-start', maxWidth: bubbleMax }}>
        <Text style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>TripMate AI</Text>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
        ) : (
          <Text style={{ backgroundColor: '#E5F3FF', borderRadius: 8, padding: 8 }}>{text}</Text>
        )}
      </View>
    );
  }

  if (isMine) {
    return (
      <TouchableOpacity onLongPress={onLongPress} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        {unreadCount > 0 ? (
          <Text style={{ fontSize: 10, color: '#999' }}>{unreadCount}</Text>
        ) : null}
        {timeStr ? <Text style={{ fontSize: 11, color: '#666' }}>{timeStr}</Text> : null}
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
        ) : (
          <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: bubbleMax, flexShrink: 1, color: isLastRead ? '#FF3B30' : undefined }}>{text}</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onLongPress={onLongPress} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
      <Image source={sender?.photoURL ? { uri: sender.photoURL! } : undefined} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#ddd' }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: bubbleMax }}>
        <View style={{ maxWidth: bubbleMax }}>
          {sender?.displayName ? (
            <Text style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{sender.displayName}</Text>
          ) : null}
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
          ) : (
            <Text style={{ backgroundColor: '#eee', borderRadius: 8, padding: 8, maxWidth: bubbleMax, flexShrink: 1 }}>{text}</Text>
          )}
        </View>
        {timeStr ? <Text style={{ fontSize: 11, color: '#666' }}>{timeStr}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}


