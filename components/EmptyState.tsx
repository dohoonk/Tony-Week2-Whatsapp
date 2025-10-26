import React from 'react';
import { View, Text, ViewProps } from 'react-native';
import AppText from './AppText';
import { colors } from '../lib/theme';

export default function EmptyState({ title, subtitle, emoji = '🗂️', style }: { title: string; subtitle?: string; emoji?: string } & ViewProps) {
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: 24 }, style]}>
      <Text style={{ fontSize: 36, marginBottom: 8 }}>{emoji}</Text>
      <AppText>{title}</AppText>
      {subtitle ? <AppText variant="meta" style={{ color: colors.textSubtle, marginTop: 4 }}>{subtitle}</AppText> : null}
    </View>
  );
}


