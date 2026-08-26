import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useApp } from '../theme/context';
import { t } from '../i18n';
import { radius, space, fonts } from '../theme/tokens';
import { Icon } from './icon';

interface ErrorFallbackProps {
  message?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function ErrorFallback({ message, onRetry, isRetrying }: ErrorFallbackProps) {
  const { c, lang } = useApp();
  const displayMsg = message || t(lang, 'sectionError');

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
        },
      ]}
    >
      <View style={styles.content}>
        <Icon name="wifiOff" size={16} color={c.danger} />
        <Text
          style={[
            styles.message,
            { color: c.text, fontFamily: lang === 'am' ? fonts.am : undefined },
          ]}
          numberOfLines={2}
        >
          {displayMsg}
        </Text>
      </View>

      {onRetry && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t(lang, 'retry')}
          onPress={onRetry}
          disabled={isRetrying}
          style={[
            styles.button,
            {
              backgroundColor: c.accentGlow,
              borderColor: c.accentDim,
            },
          ]}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color={c.accent} />
          ) : (
            <Text
              style={[
                styles.buttonText,
                { color: c.accent, fontFamily: lang === 'am' ? fonts.amBold : undefined },
              ]}
            >
              {t(lang, 'retry')}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginVertical: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
