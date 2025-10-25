import React from 'react';
import { Pressable, ActivityIndicator, Text, View, GestureResponderEvent } from 'react-native';

type Variant = 'primary' | 'secondary' | 'outline' | 'destructive';
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
  const palette = {
    primary: { bg: '#2563EB', text: '#FFFFFF', border: '#2563EB' },
    secondary: { bg: '#E5E7EB', text: '#111827', border: '#E5E7EB' },
    outline: { bg: 'transparent', text: '#2563EB', border: '#2563EB' },
    destructive: { bg: '#EF4444', text: '#FFFFFF', border: '#EF4444' },
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
      android_ripple={{ color: '#00000020' }}
      hitSlop={6}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {loading ? <ActivityIndicator color={palette.text} size="small" /> : null}
        <Text style={{ color: palette.text, fontSize, fontWeight: '600' }}>{title}</Text>
      </View>
    </Pressable>
  );
}


