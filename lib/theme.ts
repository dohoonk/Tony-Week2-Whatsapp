import { useColorScheme } from 'react-native';

// Light mode base colors
export const colors = {
  primary: '#2563EB',
  textStrong: '#111827',
  text: '#374151',
  textSubtle: '#6B7280',
  line: '#E5E7EB',
  fill: '#F3F4F6',
  surface: '#FFFFFF',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
};

// Dark mode palette mapped to the same semantic keys
export const darkColors = {
  primary: '#60A5FA',
  textStrong: '#F9FAFB',
  text: '#E5E7EB',
  textSubtle: '#9CA3AF',
  line: '#374151',
  fill: '#111827',
  surface: '#1F2937',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#93C5FD',
};

export type ThemeColors = typeof colors;

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? (darkColors as ThemeColors) : (colors as ThemeColors);
}

export const spacing = [4, 8, 12, 16, 20, 24] as const;
export const radius = { sm: 8, md: 12 } as const;

export const typography = {
  title: { fontSize: 20, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  meta: { fontSize: 13, lineHeight: 16, fontWeight: '500' as const },
};

export const shadow = {
  subtle: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
};

export const theme = { colors, spacing, radius, typography, shadow };


