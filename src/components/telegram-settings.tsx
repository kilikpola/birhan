import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useApp } from '../theme/context';
import { radius } from '../theme/tokens';
import { t } from '../i18n';
import { Icon } from './icon';
import {
  getTelegramLinkStatus,
  generateTelegramLinkCode,
  unlinkTelegramGroup,
  TelegramLinkStatus,
} from '../lib/telegram';

export function TelegramSettings() {
  const { c, lang } = useApp();
  const [status, setStatus] = useState<TelegramLinkStatus>({
    isLinked: false,
    chatId: null,
    chatTitle: null,
    verifiedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [expiryTime, setExpiryTime] = useState<Date | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isAm = lang === 'am';

  const loadStatus = useCallback(async () => {
    setLoading(true);
    const res = await getTelegramLinkStatus();
    setStatus(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Countdown timer effect for 10-minute link code expiry
  useEffect(() => {
    if (!expiryTime) {
      setTimeLeftStr('');
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const distance = expiryTime.getTime() - now;

      if (distance <= 0) {
        setActiveCode(null);
        setExpiryTime(null);
        setTimeLeftStr('');
        clearInterval(interval);
      } else {
        const mins = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((distance % (1000 * 60)) / 1000);
        setTimeLeftStr(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiryTime]);

  const handleGenerateCode = async () => {
    setErr(null);
    setGenerating(true);
    const res = await generateTelegramLinkCode();
    setGenerating(false);

    if (res.error) {
      setErr(res.error);
    } else if (res.code && res.expiresAt) {
      setActiveCode(res.code);
      setExpiryTime(res.expiresAt);
      setCopied(false);
    }
  };

  const handleCopyCode = async () => {
    if (activeCode) {
      await Clipboard.setStringAsync(activeCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleUnlink = async () => {
    Alert.alert(
      t(lang, 'btnUnlinkTelegram'),
      t(lang, 'confirmUnlinkTelegram'),
      [
        { text: isAm ? 'ሰርዝ' : 'Cancel', style: 'cancel' },
        {
          text: isAm ? 'አቋርጥ' : 'Unlink',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const res = await unlinkTelegramGroup();
            if (res.error) {
              setErr(res.error);
            } else {
              setActiveCode(null);
              setExpiryTime(null);
              await loadStatus();
            }
            setLoading(false);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[s.card, s.loadingCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <ActivityIndicator size="small" color={c.accent} />
      </View>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border, gap: 12 }]}>
      {/* Header with Title & Link Status Badge */}
      <View style={s.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="send" size={18} color={c.accent} />
          <Text style={[s.title, { color: c.text }]}>{t(lang, 'telegramSectionTitle')}</Text>
        </View>

        {status.isLinked ? (
          <View style={[s.badge, { backgroundColor: 'rgba(95,167,113,0.15)', borderColor: c.success }]}>
            <Text style={[s.badgeTxt, { color: c.success }]}>✓ {t(lang, 'telegramLinked')}</Text>
          </View>
        ) : (
          <View style={[s.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
            <Text style={[s.badgeTxt, { color: c.textSoft, fontWeight: '600' }]}>{t(lang, 'telegramNotLinked')}</Text>
          </View>
        )}
      </View>

      <View style={[s.sep, { backgroundColor: c.border }]} />

      {/* LINKED STATE UI */}
      {status.isLinked ? (
        <View style={{ gap: 12 }}>
          <View style={[s.infoBox, { backgroundColor: c.bg }]}>
            <View style={s.rowBetween}>
              <Text style={[s.infoLabel, { color: c.textSoft }]}>Chat ID:</Text>
              <Text style={[s.infoValue, { color: c.text }]}>{status.chatId || '—'}</Text>
            </View>
            {status.verifiedAt && (
              <View style={s.rowBetween}>
                <Text style={[s.infoLabel, { color: c.textSoft }]}>{isAm ? 'የተረጋገጠበት ቀን፦' : 'Verified Date:'}</Text>
                <Text style={[s.infoLabel, { color: c.textSoft }]}>
                  {new Date(status.verifiedAt).toLocaleDateString()}
                </Text>
              </View>
            )}
          </View>

          <Pressable style={[s.btn, { backgroundColor: c.danger, height: 44 }]} onPress={handleUnlink}>
            <Text style={[s.btnTxt, { color: '#FFF' }]}>{t(lang, 'btnUnlinkTelegram')}</Text>
          </Pressable>
        </View>
      ) : (
        /* UNLINKED STATE UI WITH LINK INSTRUCTIONS */
        <View style={{ gap: 12 }}>
          <Text style={[s.instrTitle, { color: c.text }]}>{t(lang, 'telegramInstructionsTitle')}</Text>

          <View style={[s.infoBox, { backgroundColor: c.bg, gap: 8 }]}>
            <Text style={[s.step, { color: c.textSoft }]}>{t(lang, 'telegramStep1')}</Text>
            <Text style={[s.step, { color: c.textSoft }]}>{t(lang, 'telegramStep2')}</Text>
            <Text style={[s.step, { color: c.textSoft }]}>{t(lang, 'telegramStep3')}</Text>
          </View>

          {/* Active Generated Code Display Card */}
          {activeCode ? (
            <View style={[s.codeCard, { backgroundColor: c.bg, borderColor: c.accent }]}>
              <Text style={[s.codeNotice, { color: c.textSoft }]}>{t(lang, 'telegramCodeNotice')}</Text>
              <Text style={[s.code, { color: c.accent }]}>{activeCode}</Text>

              {timeLeftStr ? <Text style={[s.timer, { color: c.accentDim }]}>⏱ {timeLeftStr}</Text> : null}

              <Pressable onPress={handleCopyCode}>
                <View style={[s.copyPill, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Text style={[s.copyTxt, { color: c.text }]}>
                    {copied ? (isAm ? 'ተቀድቷል ✓' : 'Copied ✓') : isAm ? 'ኮድ ቅዳ' : 'Copy Code'}
                  </Text>
                </View>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[s.btn, { backgroundColor: c.text, height: 48, opacity: generating ? 0.6 : 1 }]}
              onPress={handleGenerateCode}
              disabled={generating}
            >
              {generating ? (
                <ActivityIndicator size="small" color={c.bg} />
              ) : (
                <Text style={[s.btnTxt, { color: c.bg }]}>{t(lang, 'btnGenerateTelegramCode')}</Text>
              )}
            </Pressable>
          )}

          {err ? <Text style={[s.errTxt, { color: c.danger }]}>{err}</Text> : null}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  sep: { height: 1 },
  infoBox: { padding: 12, borderRadius: radius.md, gap: 4 },
  infoLabel: { fontSize: 12 },
  infoValue: { fontSize: 12, fontWeight: '600' },
  btn: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontSize: 14, fontWeight: '700' },
  instrTitle: { fontSize: 13.5, fontWeight: '700' },
  step: { fontSize: 12.5, lineHeight: 18 },
  codeCard: { borderWidth: 1.5, borderRadius: radius.lg, padding: 16, alignItems: 'center', gap: 8 },
  codeNotice: { fontSize: 12, textAlign: 'center' },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 3 },
  timer: { fontSize: 12, fontWeight: '600' },
  copyPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  copyTxt: { fontSize: 12, fontWeight: '600' },
  errTxt: { fontSize: 12, textAlign: 'center' },
});
