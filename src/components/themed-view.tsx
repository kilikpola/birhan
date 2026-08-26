import { View, type ViewProps } from 'react-native';
import { useApp } from '@/theme/context';

export type ThemedViewProps = ViewProps & {
  type?: 'bg' | 'surface' | 'border';
};

export function ThemedView({ style, type = 'bg', ...otherProps }: ThemedViewProps) {
  const { c: colors } = useApp();

  return (
    <View 
      style={[{ backgroundColor: colors[type] }, style]} 
      {...otherProps} 
    />
  );
}
