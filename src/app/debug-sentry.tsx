import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { dark } from '../theme/tokens';
import { reportError } from '../lib/errors';

/**
 * Deliberate test-error surface to verify the whole Sentry pipeline end to end
 * (capture -> upload -> alert). DEV ONLY: it renders nothing unless __DEV__ or
 * EXPO_PUBLIC_ENABLE_DEBUG=1, so it can never become a live route in a normal
 * production build. Reach it by deep link `birhan://debug-sentry` or
 * router.navigate('/debug-sentry').
 *
 * Each button exercises a different capture path:
 *  - captureMessage: a manual breadcrumb-style event
 *  - handled exception via reportError: the app's normal error funnel
 *  - unhandled render error: throws during render (ErrorBoundary + Sentry)
 *  - native crash: hard crash to prove native symbolication works
 */
const DEBUG_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_DEBUG === '1';

export default function DebugSentry() {
  const [boom, setBoom] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  if (!DEBUG_ENABLED) {
    return (
      <View style={[styles.container, { backgroundColor: dark.bg }]}>
        <Text style={{ color: dark.textSoft }}>Not available.</Text>
      </View>
    );
  }

  // Throw during render to exercise the unhandled path via the ErrorBoundary.
  if (boom) {
    throw new Error('Birhan Sentry test: unhandled render error');
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: dark.bg }]}>
      <Text style={[styles.title, { color: dark.text }]}>Sentry pipeline test</Text>
      <Text style={[styles.note, { color: dark.textFaint }]}>
        Dev-only. Sends test events to the configured Sentry project.
        {lastEventId ? `\nLast event id: ${lastEventId}` : ''}
      </Text>

      <Btn
        label="1 · captureMessage"
        onPress={() => setLastEventId(Sentry.captureMessage('Birhan Sentry test: manual message'))}
      />
      <Btn
        label="2 · handled error (reportError)"
        onPress={() => reportError(new Error('Birhan Sentry test: handled exception'), 'DebugSentry', 'en', false)}
      />
      <Btn label="3 · unhandled render error" onPress={() => setBoom(true)} />
      <Btn label="4 · native crash" onPress={() => Sentry.nativeCrash()} danger />
    </ScrollView>
  );
}

function Btn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.button, { backgroundColor: danger ? dark.danger : dark.accent }]}
    >
      <Text style={[styles.buttonText, { color: dark.bg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, gap: 12, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  note: { fontSize: 13, marginBottom: 16, lineHeight: 19 },
  button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700' },
});
