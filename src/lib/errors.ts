import { t, Lang, Key } from '../i18n';
import { captureMonitoringError } from './monitoring';

type ErrorListener = (message: string, type: 'error' | 'info' | 'success') => void;

const listeners: Set<ErrorListener> = new Set();

export function subscribeToast(listener: ErrorListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyToast(message: string, type: 'error' | 'info' | 'success' = 'error') {
  listeners.forEach((listener) => listener(message, type));
}

/**
 * Centralized error reporting function.
 * Logs detailed information in __DEV__ and sanitized summaries in production.
 * Returns a short, human-actionable, localized error message.
 */

function readCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const code = (err as Record<string, unknown>).code;
  return code != null && code !== '' ? String(code) : '';
}

function readMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message && err.message.trim()) return `${err.name}: ${err.message}`;
    if (readCode(err)) return `${err.name || 'Error'} [${readCode(err)}]`;
    return err.name || 'Error';
  }
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const msg = obj.message != null ? String(obj.message).trim() : '';
    if (msg) return msg;
    const details = obj.details || obj.description || obj.reason || obj.error_description;
    if (details) return String(details).trim();
    const code = readCode(err);
    if (code) return `Error [${code}]`;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function extractCauses(err: unknown, depth = 0): string[] {
  if (depth > 5 || !err) return [];
  const causes: string[] = [];

  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    const rawCause = obj.cause || obj.originalError || obj.nativeError;
    if (rawCause) {
      causes.push(readMessage(rawCause));
      causes.push(...extractCauses(rawCause, depth + 1));
    }
    if (obj.userInfo && typeof obj.userInfo === 'object') {
      causes.push(`userInfo: ${JSON.stringify(obj.userInfo)}`);
    }
  }
  return causes;
}

function normalizeError(error: unknown): {
  errMessage: string;
  errCode: string;
  errCauses: string[];
  errStack: string;
} {
  let errMessage = readMessage(error);
  let errCode = readCode(error);
  let errCauses = extractCauses(error);
  let errStack = '';

  if (error instanceof Error) {
    errStack = error.stack || '';
  } else if (error && typeof error === 'object') {
    const stack = (error as Record<string, unknown>).stack || (error as Record<string, unknown>).nativeStackAndroid;
    errStack = stack ? String(stack) : '';
  }

  // expo-modules often wraps the real failure in `.cause` with an empty `.message` or generic 'Error'.
  if ((!errMessage.trim() || errMessage === 'Error' || errMessage.startsWith('Error: [') || errMessage.startsWith('Error [')) && errCauses.length > 0) {
    const realCause = errCauses.find((c) => c && c.trim() && c !== 'Error');
    if (realCause) {
      errMessage = realCause;
    }
  }

  if (!errMessage.trim()) {
    errMessage = errCode ? `Unknown error [${errCode}]` : '(Empty error message)';
  }

  return { errMessage, errCode, errCauses, errStack };
}

export function reportError(
  error: unknown,
  context: string = 'General',
  lang: Lang = 'am',
  showToast: boolean = true
): string {
  const { errMessage, errCode, errCauses, errStack } = normalizeError(error);

  const causeLog = errCauses.length > 0 ? ` | Causes: [${errCauses.join(' -> ')}]` : '';
  const codeLog = errCode ? ` | Code: ${errCode}` : '';
  const stackLog = errStack ? `\nStack:\n${errStack}` : '';

  const formattedLog = `[BIRHAN_ERROR:${context}] ${errMessage}${codeLog}${causeLog}${stackLog}`;

  if (__DEV__) {
    console.error(formattedLog);
  } else {
    console.error(`[BIRHAN_ERROR:${context}] ${errMessage.split('\n')[0]}`);
    // Ship the full error (with stack) to Sentry in production. No-op until
    // monitoring is initialised with a DSN; never throws.
    captureMonitoringError(error, context);
  }

  // Classify error to localized i18n key
  let errorKey: Key = 'errGeneric';
  const lowerMsg = errMessage.toLowerCase();

  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('fetch') ||
    lowerMsg.includes('connection') ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('internet')
  ) {
    errorKey = 'errNetwork';
  } else if (
    lowerMsg.includes('permission') ||
    lowerMsg.includes('denied') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('rls') ||
    lowerMsg.includes('403')
  ) {
    errorKey = 'errPermission';
  } else if (
    lowerMsg.includes('sqlite') ||
    lowerMsg.includes('database') ||
    lowerMsg.includes('prepareasync') ||
    lowerMsg.includes('query')
  ) {
    errorKey = 'errDatabase';
  }

  const userFacingMessage = t(lang, errorKey);

  if (showToast) {
    notifyToast(userFacingMessage, 'error');
  }

  return userFacingMessage;
}
