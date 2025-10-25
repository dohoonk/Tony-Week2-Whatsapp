import React from 'react';
import { View, Text } from 'react-native';
import { colors, radius, spacing } from '../lib/theme';

type Kind = 'info' | 'success' | 'warning' | 'error';

const bg: Record<Kind, string> = {
  info: '#EFF6FF',
  success: '#ECFDF5',
  warning: '#FFFBEB',
  error: '#FEF2F2',
};
const fg: Record<Kind, string> = {
  info: colors.info,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
};

export default function Banner({ kind = 'info', children }: { kind?: Kind; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: bg[kind], paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.md }}>
      <Text style={{ color: fg[kind] }}>{children}</Text>
    </View>
  );
}


