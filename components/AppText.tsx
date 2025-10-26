import React from 'react';
import { Text, TextProps } from 'react-native';
import { typography, useThemeColors } from '../lib/theme';

type Variant = 'title' | 'body' | 'meta';

export default function AppText({ variant = 'body', style, children, ...rest }: TextProps & { variant?: Variant }) {
  const palette = useThemeColors();
  const base = variant === 'title' ? typography.title : variant === 'meta' ? typography.meta : typography.body;
  const color = variant === 'meta' ? palette.textSubtle : palette.text;
  return (
    <Text {...rest} style={[{ color }, base as any, style]}>
      {children}
    </Text>
  );
}


