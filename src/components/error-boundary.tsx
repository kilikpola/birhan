import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { reportError } from '../lib/errors';
import { Logo } from './logo';
import { dark } from '../theme/tokens';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, `ErrorBoundary:${errorInfo.componentStack?.split('\n')[1]?.trim() || 'React'}`);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={[styles.container, { backgroundColor: dark.bg }]}>
          <View style={[styles.card, { backgroundColor: dark.surface, borderColor: dark.border }]}>
            <Logo size={64} />
            <Text style={[styles.title, { color: dark.text }]}>
              ስህተት ተከሰተ
            </Text>
            <Text style={[styles.subtitle, { color: dark.textSoft }]}>
              Something went wrong while rendering this section. Please try again.
            </Text>
            <TouchableOpacity
              onPress={this.handleReset}
              style={[styles.button, { backgroundColor: dark.accent }]}
            >
              <Text style={[styles.buttonText, { color: dark.bg }]}>
                ድጋሚ ይሞክሩ (Try again)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
