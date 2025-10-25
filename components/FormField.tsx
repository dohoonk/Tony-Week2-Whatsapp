import React from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '../lib/theme';

type Props = {
  label: string;
  helpText?: string;
  errorText?: string;
  hideLabel?: boolean;
} & TextInputProps;

export default function FormField({ label, helpText, errorText, hideLabel, style, ...inputProps }: Props) {
  const hasError = !!errorText;
  return (
    <View style={{ marginBottom: spacing[3] }}>
      {!hideLabel ? (
        <Text style={{ color: colors.textSubtle, ...(typography.meta as any), marginBottom: 6 }}>{label}</Text>
      ) : null}
      <TextInput
        {...inputProps}
        style={[
          {
            borderWidth: 1,
            borderColor: hasError ? colors.error : '#ccc',
            borderRadius: radius.md,
            padding: 12,
            color: colors.text,
            backgroundColor: '#fff',
          },
          style,
        ]}
      />
      {hasError ? (
        <Text style={{ color: colors.error, ...(typography.meta as any), marginTop: 6 }}>{errorText}</Text>
      ) : helpText ? (
        <Text style={{ color: colors.textSubtle, ...(typography.meta as any), marginTop: 6 }}>{helpText}</Text>
      ) : null}
    </View>
  );
}


