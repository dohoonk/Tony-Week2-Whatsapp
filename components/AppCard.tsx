import React from 'react';
import { View, ViewProps } from 'react-native';
import { radius, shadow } from '../lib/theme';

export default function AppCard({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[{ backgroundColor: '#fff', borderRadius: radius.md, padding: 12 }, shadow.subtle, style]}>
      {children}
    </View>
  );
}


