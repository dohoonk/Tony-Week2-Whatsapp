import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../lib/theme';

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
  const c = useThemeColors();
  const isDark = c.surface === '#1F2937';
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

  // Render nicely formatted Weather blocks for AI messages
  const renderAIWeather = (raw?: string) => {
    if (!raw) return null;
    if (!/^\s*Weather for /i.test(raw)) return null;
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const cityLine = lines[0];
    const rows: Array<{ date: string; icon?: string; temp: string; cond: string }> = [];
    for (let i = 1; i < lines.length; ) {
      const date = lines[i++] || '';
      const tempLine = lines[i++] || '';
      const cond = lines[i++] || '';
      const m = /(https?:\/\/\S+)/.exec(tempLine);
      const icon = m?.[1];
      const temp = tempLine.replace(m?.[1] || '', '').trim();
      if (date) rows.push({ date, icon, temp, cond });
      // skip possible blank spacer
      if (i < lines.length && lines[i] === '') i++;
    }
    return (
      <View style={{ backgroundColor: isDark ? '#0B1220' : '#E5F3FF', borderRadius: 8, padding: 8, maxWidth: bubbleMax }}>
        <Text style={{ color: c.text, fontWeight: '600', marginBottom: 6 }}>{cityLine}</Text>
        {rows.map((r, idx) => (
          <View key={idx} style={{ marginBottom: 8 }}>
            <Text style={{ color: c.text }}>{r.date}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {r.icon ? <Image source={{ uri: r.icon }} style={{ width: 18, height: 18 }} /> : null}
              <Text style={{ color: c.text }}>{r.temp}</Text>
            </View>
            {r.cond ? <Text style={{ color: c.text }}>{r.cond}</Text> : null}
          </View>
        ))}
      </View>
    );
  };

  if (isAI) {
    return (
      <View style={{ marginBottom: 8, alignSelf: 'flex-start', maxWidth: bubbleMax }}>
        <Text style={{ fontSize: 11, color: c.textSubtle, marginBottom: 2 }}>TripMate AI</Text>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
        ) : (
          renderAIWeather(text) ?? (
            <Text style={{ backgroundColor: isDark ? '#0B1220' : '#E5F3FF', color: c.text, borderRadius: 8, padding: 8 }}>{text}</Text>
          )
        )}
      </View>
    );
  }

  if (isMine) {
    return (
      <TouchableOpacity onLongPress={onLongPress} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
        ) : (
          <Text style={{ backgroundColor: c.fill, color: isLastRead ? '#FF3B30' : c.text, borderRadius: 8, padding: 8, maxWidth: bubbleMax, flexShrink: 1 }}>{text}</Text>
        )}
        <View style={{ width: 46, alignItems: 'flex-end' }}>
          {unreadCount > 0 ? (
            <Text style={{ fontSize: 10, lineHeight: 12, color: c.textSubtle }} numberOfLines={1}>{unreadCount}</Text>
          ) : <Text style={{ fontSize: 10, lineHeight: 12, color: 'transparent' }}>0</Text>}
          {timeStr ? <Text style={{ fontSize: 10, lineHeight: 12, color: c.textSubtle }} numberOfLines={1}>{timeStr}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onLongPress={onLongPress} activeOpacity={0.9} style={{ marginBottom: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
      <Image source={sender?.photoURL ? { uri: sender.photoURL! } : undefined} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.line }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: bubbleMax }}>
        <View style={{ maxWidth: bubbleMax }}>
          {sender?.displayName ? (
            <Text style={{ fontSize: 11, color: c.textSubtle, marginBottom: 2 }}>{sender.displayName}</Text>
          ) : null}
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={{ width: Math.min(200, bubbleMax), height: 200, borderRadius: 8 }} />
          ) : (
            <Text style={{ backgroundColor: c.fill, color: c.text, borderRadius: 8, padding: 8, maxWidth: bubbleMax, flexShrink: 1 }}>{text}</Text>
          )}
        </View>
        {timeStr ? <Text style={{ fontSize: 10, lineHeight: 12, color: c.textSubtle }} numberOfLines={1}>{timeStr}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}


