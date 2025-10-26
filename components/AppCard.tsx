import React from 'react';
import { View, ViewProps } from 'react-native';
import { radius, shadow, useThemeColors } from '../lib/theme';

type Props = ViewProps & {
  padding?: number;
  elevated?: boolean;
  background?: string;
};

export default function AppCard({ style, children, padding = 16, elevated = true, background, ...rest }: Props) {
  const palette = useThemeColors();
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: background ?? palette.surface, borderRadius: radius.md, padding, borderWidth: 1, borderColor: palette.line },
        elevated ? shadow.subtle : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}


