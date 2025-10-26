import React from 'react';
import { View, ViewProps } from 'react-native';
import { radius, shadow } from '../lib/theme';

type Props = ViewProps & {
  padding?: number;
  elevated?: boolean;
  background?: string;
};

export default function AppCard({ style, children, padding = 16, elevated = true, background = '#fff', ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: background, borderRadius: radius.md, padding, borderWidth: 1, borderColor: '#E5E7EB' },
        elevated ? shadow.subtle : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}


