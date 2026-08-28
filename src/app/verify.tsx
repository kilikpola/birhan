import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/theme/context';
import { useAuth } from '@/lib/auth';
import { Icon } from '@/components/icon';
import { Logo } from '@/components/logo';
import { radius, space } from '@/theme/tokens';
import { t } from '@/i18n';
import { reportError } from '@/lib/errors';

/**
 * Landing point for the emailed verification link.
 *
 * The link itself opens in a browser (backend/src/routes/auth.ts serves an
 * HTML confirmation page there, since a mail client won't hand a custom
 * scheme to the app) — that page's "Open Birhan" button is what deep-links
 * here as birhan://verify?status=verified|already_verified|used|expired|invalid.
 * The token itself was already consumed server-side rendering that page, so
 * this screen never sees or needs it — only the outcome.
 */
type Status = 'verified' | 'already_verified' | 'used' | 'expired' | 'invalid';

export default function VerifyScreen() {
  const { c, lang } = useApp();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const { syncVerification, resendVerificationEmail } = useAuth();
  const [syncing, setSyncing] = useState(true);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendMsg, setResendMsg] = useState<string | null>(null);

  const resolvedStatus: Status =
    status === 'verified' || status === 'already_verified' || status === 'used' || status === 'expired' || status === 'invalid'
      ? status
      : 'invalid';
  const ok = resolvedStatus === 'verified' || resolvedStatus === 'already_verified';
  const canResend = resolvedStatus === 'used' || resolvedStatus === 'expired';

  useEffect(() => {
    if (ok) {
      syncVerification()
        .catch((err) => reportError(err, 'Verify.syncVerification', lang, false))
        .finally(() => setSyncing(false));
    } else {
      setSyncing(false);
    }
  }, [ok, syncVerification, lang]);

  const handleResend = async () => {
    setResendState('sending');
    setResendMsg(null);
    const res = await resendVerificationEmail();
    if (res.status === 'sent') {
      setResendState('sent');
    } else if (res.status === 'already_verified') {
      setResendState('sent');
      syncVerification().catch(() => {});
    } else {
      setResendState('error');
      setResendMsg(res.message);
    }
  };

  const title = {
    verified: t(lang, 'emailVerifiedTitle'),
    already_verified: t(lang, 'emailVerifiedTitle'),
    used: t(lang, 'verifyLinkUsed'),
    expired: t(lang, 'verifyLinkExpired'),
    invalid: t(lang, 'verifyLinkInvalid'),
  }[resolvedStatus];

  const note = ok
    ? resolvedStatus === 'already_verified'
      ? t(lang, 'emailAlreadyVerified')
      : t(lang, 'emailVerifiedNote')
    : undefined;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.center}>
        <Logo size={56} style={{ marginBottom: space.md }} />

        {syncing ? (
          <>
            <ActivityIndicator color={c.accent} style={{ marginBottom: space.md }} />
            <Text style={[styles.title, { color: c.text }]}>{t(lang, 'verifyingEllipsis')}</Text>
          </>
        ) : (
          <>
            <View
              style={[
                styles.iconCircle,
                ok
                  ? { borderColor: c.success, backgroundColor: 'rgba(95,167,113,0.12)' }
                  : { borderColor: c.danger, backgroundColor: 'rgba(210,86,75,0.10)' },
              ]}
            >
              <Icon name={ok ? 'check' : 'alert'} size={28} color={ok ? c.success : c.danger} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>{title}</Text>
            {!!note && <Text style={[styles.note, { color: c.textSoft }]}>{note}</Text>}

            {canResend && (
              <View style={{ marginTop: space.lg, alignItems: 'center' }}>
                {resendState === 'sent' ? (
                  <Text style={[styles.resendDone, { color: c.success }]}>{t(lang, 'resendSentConfirm')} ✓</Text>
                ) : (
                  <Pressable
                    onPress={handleResend}
                    disabled={resendState === 'sending'}
                    style={[styles.resendBtn, { borderColor: c.border, opacity: resendState === 'sending' ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.resendBtnTxt, { color: c.accent }]}>
                      {resendState === 'sending' ? t(lang, 'resendSending') : t(lang, 'btnRequestNewLink')}
                    </Text>
                  </Pressable>
                )}
                {!!resendMsg && <Text style={[styles.errText, { color: c.danger }]}>{resendMsg}</Text>}
              </View>
            )}

            <Pressable
              style={[styles.goBtn, { backgroundColor: c.text }]}
              onPress={() => router.replace('/')}
            >
              <Text style={[styles.goBtnTxt, { color: c.bg }]}>{t(lang, 'btnGoToApp')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: { fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  note: { fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  resendBtn: { height: 46, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  resendBtnTxt: { fontSize: 14, fontWeight: '700' },
  resendDone: { fontSize: 14, fontWeight: '700' },
  errText: { fontSize: 12.5, marginTop: 8, textAlign: 'center' },
  goBtn: { height: 50, borderRadius: radius.md, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', marginTop: space.xl },
  goBtnTxt: { fontSize: 15, fontWeight: '700' },
});
