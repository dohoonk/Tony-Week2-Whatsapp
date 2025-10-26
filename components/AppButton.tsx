import React from 'react';
import { Pressable, ActivityIndicator, Text, View, GestureResponderEvent } from 'react-native';
import { useThemeColors } from '../lib/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost';
type Size = 'sm' | 'md';

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
}: {
  title: string;
  onPress: (e: GestureResponderEvent) => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
}) {
  const c = useThemeColors();
  const palette = {
    primary: { bg: c.primary, text: '#FFFFFF', border: c.primary },
    secondary: { bg: c.fill, text: c.textStrong, border: c.line },
    outline: { bg: 'transparent', text: c.primary, border: c.primary },
    destructive: { bg: c.error, text: '#FFFFFF', border: c.error },
    ghost: { bg: 'transparent', text: c.primary, border: 'transparent' },
  }[variant];

  const padV = size === 'sm' ? 8 : 10;
  const padH = size === 'sm' ? 12 : 14;
  const fontSize = size === 'sm' ? 14 : 16;
  const opacity = disabled ? 0.6 : 1;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 * opacity : opacity,
        backgroundColor: palette.bg,
        borderColor: palette.border,
        borderWidth: variant === 'outline' ? 1 : 0,
        paddingVertical: padV,
        paddingHorizontal: padH,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 44,
      })}
      android_ripple={variant === 'ghost' ? undefined : { color: '#00000020' }}
      hitSlop={6}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {loading ? <ActivityIndicator color={palette.text} size="small" /> : null}
        <Text style={{ color: palette.text, fontSize, fontWeight: '600' }}>{title}</Text>
      </View>
    </Pressable>
  );
}


