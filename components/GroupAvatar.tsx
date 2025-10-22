import React from 'react';
import { View, Image } from 'react-native';

export default function GroupAvatar({ uris, size = 40 }: { uris: (string | null | undefined)[]; size?: number }) {
  const imgs = (uris || []).filter(Boolean).slice(0, 4) as string[];
  const cell = Math.floor(size / 2);
  if (imgs.length === 0) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#eee' }} />;
  }
  return (
    <View style={{ width: size, height: size, flexWrap: 'wrap', borderRadius: size / 2, overflow: 'hidden', flexDirection: 'row' }}>
      {imgs.map((u, i) => (
        <Image key={i} source={{ uri: u }} style={{ width: cell, height: cell }} />
      ))}
      {Array.from({ length: 4 - imgs.length }).map((_, i) => (
        <View key={`p${i}`} style={{ width: cell, height: cell, backgroundColor: '#eee' }} />
      ))}
    </View>
  );
}



