import React from 'react';
import { Text, TextProps } from 'react-native';
import { typography, colors } from '../lib/theme';

type Variant = 'title' | 'body' | 'meta';

export default function AppText({ variant = 'body', style, children, ...rest }: TextProps & { variant?: Variant }) {
  const base = variant === 'title' ? typography.title : variant === 'meta' ? typography.meta : typography.body;
  const color = variant === 'meta' ? colors.textSubtle : colors.text;
  return (
    <Text {...rest} style={[{ color }, base as any, style]}>
      {children}
    </Text>
  );
}


