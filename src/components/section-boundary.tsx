import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { reportError } from '../lib/errors';
import { ErrorFallback } from './error-fallback';

interface Props {
  name: string;
  fallback?: ReactNode;
  skeleton?: ReactNode;
  loading?: boolean;
  onRetry?: () => Promise<void> | void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
  isRetrying: boolean;
  retryCount: number;
  isOnline: boolean;
}

export class SectionBoundary extends Component<Props, State> {
  private netInfoUnsub: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  public state: State = {
    hasError: false,
    errorMessage: null,
    isRetrying: false,
    retryCount: 0,
    isOnline: true,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      errorMessage: error.message || 'Error loading section',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, `SectionBoundary.${this.props.name}`);
    this.scheduleAutoRetry(error.message);
  }

  public componentDidMount() {
    this.netInfoUnsub = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
      this.setState((prev) => {
        if (!prev.isOnline && isOnline && prev.hasError) {
          // Connectivity returned, attempt retry if previously failed
          this.handleRetry();
        }
        return { isOnline };
      });
    });
  }

  public componentWillUnmount() {
    if (this.netInfoUnsub) this.netInfoUnsub();
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private isNonRetryableError(msg?: string | null): boolean {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    return (
      lower.includes('403') ||
      lower.includes('permission') ||
      lower.includes('denied') ||
      lower.includes('unauthorized') ||
      lower.includes('rls') ||
      // Native module missing — retrying will never fix this
      lower.includes('native module') ||
      lower.includes('nativemodule') ||
      lower.includes('turbomodule') ||
      lower.includes('cannot read') ||
      lower.includes('is not a function') ||
      lower.includes('null is not an object')
    );
  }

  private scheduleAutoRetry(errorMsg?: string) {
    if (this.isNonRetryableError(errorMsg)) return;
    if (!this.state.isOnline) return;
    if (this.state.retryCount >= 3) return;

    const backoffMs = Math.pow(2, this.state.retryCount) * 1000;
    this.retryTimer = setTimeout(() => {
      this.handleRetry();
    }, backoffMs);
  }

  public handleRetry = async () => {
    if (this.state.isRetrying) return; // Prevent double-fire

    this.setState({ isRetrying: true });
    try {
      if (this.props.onRetry) {
        await this.props.onRetry();
      }
      this.setState({
        hasError: false,
        errorMessage: null,
        isRetrying: false,
        retryCount: 0,
      });
    } catch (err) {
      reportError(err, `SectionBoundary.${this.props.name}.retry`);
      this.setState((prev) => ({
        hasError: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        isRetrying: false,
        retryCount: prev.retryCount + 1,
      }));
    }
  };

  public render() {
    const { skeleton, loading, fallback, children } = this.props;
    const { hasError, errorMessage, isRetrying } = this.state;

    if (loading && skeleton) {
      return (
        <View accessibilityState={{ busy: true }}>
          {skeleton}
        </View>
      );
    }

    if (hasError) {
      if (fallback) return fallback;
      return (
        <ErrorFallback
          message={errorMessage || undefined}
          onRetry={this.props.onRetry ? this.handleRetry : undefined}
          isRetrying={isRetrying}
        />
      );
    }

    return children;
  }
}
