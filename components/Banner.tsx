import React from 'react';
import { View, Text } from 'react-native';
import { useThemeColors, radius, spacing, shadow } from '../lib/theme';

type Kind = 'info' | 'success' | 'warning' | 'error';

const lightBg: Record<Kind, string> = {
  info: '#EFF6FF',
  success: '#ECFDF5',
  warning: '#FFFBEB',
  error: '#FEF2F2',
};
const darkBg: Record<Kind, string> = {
  info: '#0B1220',
  success: '#052e24',
  warning: '#2b210a',
  error: '#2a0f10',
};

export default function Banner({ kind = 'info', children }: { kind?: Kind; children: React.ReactNode }) {
  const palette = useThemeColors();
  return (
    <View style={[{ backgroundColor: (palette.surface === '#1F2937' ? darkBg[kind] : lightBg[kind]), paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: radius.md, borderWidth: 1, borderColor: palette.line }, shadow.subtle]}>
      <Text style={{ color: (palette as any)[kind] ?? palette.info }}>{children}</Text>
    </View>
  );
}


