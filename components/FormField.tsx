import React from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { useThemeColors, radius, spacing, typography } from '../lib/theme';

type Props = {
  label: string;
  helpText?: string;
  errorText?: string;
  hideLabel?: boolean;
} & TextInputProps;

export default function FormField({ label, helpText, errorText, hideLabel, style, ...inputProps }: Props) {
  const palette = useThemeColors();
  const hasError = !!errorText;
  return (
    <View style={{ marginBottom: hideLabel ? 0 : spacing[3] }}>
      {!hideLabel ? (
        <Text style={{ color: palette.textSubtle, ...(typography.meta as any), marginBottom: 6 }}>{label}</Text>
      ) : null}
      <TextInput
        {...inputProps}
        style={[
          {
            borderWidth: 1,
            borderColor: hasError ? palette.error : palette.line,
            borderRadius: radius.md,
            padding: 12,
            color: palette.text,
            backgroundColor: palette.surface,
          },
          style,
        ]}
      />
      {hasError ? (
        <Text style={{ color: palette.error, ...(typography.meta as any), marginTop: 6 }}>{errorText}</Text>
      ) : helpText ? (
        <Text style={{ color: palette.textSubtle, ...(typography.meta as any), marginTop: 6 }}>{helpText}</Text>
      ) : null}
    </View>
  );
}


