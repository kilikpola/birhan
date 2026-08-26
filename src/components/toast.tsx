import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../theme/context';
import { subscribeToast } from '../lib/errors';
import { radius, space, fonts } from '../theme/tokens';
import { Icon } from './icon';

type ToastType = 'error' | 'info' | 'success';

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: (msg: string, type: ToastType = 'info') => {
        console.log(`[Toast Fallback] ${type}: ${msg}`);
      },
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { c } = useApp();
  const insets = useSafeAreaInsets();

  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [fadeAnim] = useState(() => new Animated.Value(0));

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      setToast({ message, type });
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 3000);
    },
    [fadeAnim]
  );

  useEffect(() => {
    const unsub = subscribeToast((msg, type) => showToast(msg, type));
    return () => unsub();
  }, [showToast]);

  const getBorderColor = () => {
    if (!toast) return c.borderLit;
    if (toast.type === 'error') return c.danger;
    if (toast.type === 'success') return c.success;
    return c.lapis;
  };

  const getIconName = () => {
    if (!toast) return 'note';
    if (toast.type === 'error') return 'wifiOff';
    if (toast.type === 'success') return 'check';
    return 'note';
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.container,
            {
              top: insets.top + 10,
              backgroundColor: c.surface,
              borderColor: getBorderColor(),
              opacity: fadeAnim,
              transform: [
                {
                  translateY: fadeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Icon name={getIconName() as any} size={16} color={getBorderColor()} />
          <Text style={[styles.text, { color: c.text, fontFamily: fonts.ui }]}>
            {toast.message}
          </Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    zIndex: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  text: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '500',
    lineHeight: 18,
  },
});
