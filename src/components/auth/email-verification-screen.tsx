import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Logo } from '@/components/logo';
import { Icon } from '@/components/icon';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';
import { reportError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';

/** "kidus@example.com" -> "ki••••@example.com" — never shows the full address. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const visible = email.slice(0, Math.min(2, at));
  return `${visible}••••${email.slice(at)}`;
}

const RESEND_DEBOUNCE_SECONDS = 20;

export function EmailVerificationScreen({
  c,
  lang,
  email,
  verificationSent,
  onDone,
}: {
  c: Palette;
  lang: Lang;
  email: string;
  /** Whether the backend actually got the first email out — false also means
   * "no SMTP configured", not just "delivery failed"; either way the resend
   * button is how they get one. */
  verificationSent: boolean;
  onDone: () => void;
}) {
  const { resendVerificationEmail, syncVerification, profile } = useAuth();
  const [sending, setSending] = useState(false);
  const [sentJustNow, setSentJustNow] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [verified, setVerified] = useState(profile?.email_verified ?? false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (profile?.email_verified) setVerified(true);
  }, [profile?.email_verified]);

  // Poll gently while this screen is open — the user may verify from another
  // device or a webmail tab without ever returning through the deep link.
  useEffect(() => {
    const id = setInterval(() => {
      syncVerification().catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [syncVerification]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_DEBOUNCE_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    setResendError(null);
    setSentJustNow(false);
    setSending(true);
    const res = await resendVerificationEmail();
    setSending(false);

    if (res.status === 'sent') {
      setSentJustNow(true);
      startCooldown();
    } else if (res.status === 'already_verified') {
      setVerified(true);
      syncVerification().catch((err) => reportError(err, 'EmailVerification.sync', lang, false));
    } else {
      setResendError(res.message);
    }
  };

  const handleOpenEmail = async () => {
    try {
      await Linking.openURL('mailto:');
    } catch (err) {
      reportError(err, 'EmailVerification.openEmail', lang, false);
    }
  };

  if (verified) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
        <View style={styles.center}>
          <View style={[styles.checkCircle, { borderColor: c.success, backgroundColor: 'rgba(95,167,113,0.12)' }]}>
            <Icon name="check" size={30} color={c.success} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>{t(lang, 'emailVerifiedTitle')}</Text>
          <Text style={[styles.note, { color: c.textSoft }]}>{t(lang, 'emailVerifiedNote')}</Text>
          <Pressable style={[styles.doneBtn, { backgroundColor: c.text }]} onPress={onDone}>
            <Text style={[styles.doneBtnTxt, { color: c.bg }]}>{t(lang, 'btnGoToApp')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.center}>
        <Logo size={56} style={{ marginBottom: space.md }} />
        <Text style={[styles.title, { color: c.text }]}>{t(lang, 'checkYourEmail')}</Text>
        <Text style={[styles.note, { color: c.textSoft }]}>{t(lang, 'verificationSentTo')}</Text>
        <Text style={[styles.email, { color: c.accent }]}>{maskEmail(email)}</Text>
        <Text style={[styles.instructions, { color: c.textSoft }]}>{t(lang, 'verificationInstructions')}</Text>

        {!verificationSent && !sentJustNow && (
          <Text style={[styles.firstSendNote, { color: c.danger }]}>{t(lang, 'firstEmailNotSent')}</Text>
        )}

        <Pressable style={[styles.openBtn, { backgroundColor: c.text }]} onPress={handleOpenEmail}>
          <Text style={[styles.openBtnTxt, { color: c.bg }]}>{t(lang, 'btnOpenEmail')}</Text>
        </Pressable>

        <View style={styles.resendBlock}>
          <Text style={[styles.resendPrompt, { color: c.textFaint }]}>{t(lang, 'resendPrompt')}</Text>
          {sending ? (
            <Text style={[styles.resendLink, { color: c.textFaint }]}>{t(lang, 'resendSending')}</Text>
          ) : cooldown > 0 ? (
            <Text style={[styles.resendLink, { color: c.textFaint }]}>
              {sentJustNow ? `${t(lang, 'resendSentConfirm')} ✓ · ` : ''}
              {t(lang, 'resendWaitNote').replace('%1', `0:${String(cooldown).padStart(2, '0')}`)}
            </Text>
          ) : (
            <Pressable onPress={handleResend} hitSlop={8}>
              <Text style={[styles.resendLink, { color: c.accent }]}>{t(lang, 'btnResendEmail')}</Text>
            </Pressable>
          )}
          {!!resendError && <Text style={[styles.errText, { color: c.danger }]}>{resendError}</Text>}
        </View>

        <Text style={[styles.continueNote, { color: c.textFaint }]}>{t(lang, 'continueUsingBirhan')}</Text>
        <Pressable onPress={onDone} hitSlop={8} style={{ marginTop: space.md }}>
          <Text style={[styles.continueLink, { color: c.accent }]}>{t(lang, 'btnGoToApp')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  note: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  email: { fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 14 },
  instructions: { fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginBottom: space.lg },
  firstSendNote: { fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginBottom: space.md, maxWidth: 280 },
  openBtn: { height: 50, borderRadius: radius.md, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  openBtnTxt: { fontSize: 15, fontWeight: '700' },
  resendBlock: { alignItems: 'center', marginBottom: space.lg },
  resendPrompt: { fontSize: 13, marginBottom: 4 },
  resendLink: { fontSize: 14, fontWeight: '700' },
  errText: { fontSize: 12.5, marginTop: 6, textAlign: 'center' },
  continueNote: { fontSize: 12, textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  continueLink: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  doneBtn: { height: 50, borderRadius: radius.md, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', marginTop: space.lg },
  doneBtnTxt: { fontSize: 15, fontWeight: '700' },
});
