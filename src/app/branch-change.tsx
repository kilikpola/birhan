import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/theme/context';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { t } from '@/i18n';
import { radius, space, fonts } from '@/theme/tokens';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { reportError } from '@/lib/errors';

type Branch = { id: string; name_am: string; name_en: string };
type Pending = { id: string; toBranchName: string } | null;
type History = {
  current: { id: string; name: string } | null;
  past: { branchName: string | null; leftAt: string | null }[];
};

export default function BranchChangeScreen() {
  const { c, lang } = useApp();
  const { profile, refreshProfile } = useAuth();
  const isAm = lang === 'am';

  const churchId = (profile as any)?.church_id as string | undefined;
  const currentBranchId = (profile as any)?.branch_id as string | null | undefined;
  const currentBranchName = (profile as any)?.branch_name as string | null | undefined;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!churchId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [b, p, h] = await Promise.all([
        apiFetch<{ branches: Branch[] }>(`/api/v1/churches/${churchId}/branches`, { auth: false }),
        apiFetch<{ pending: Pending }>('/api/v1/me/branch-change'),
        apiFetch<History>('/api/v1/me/branch-history'),
      ]);
      setBranches(b.branches ?? []);
      setPending(p.pending ?? null);
      setHistory(h);
    } catch (err) {
      reportError(err, 'BranchChange.load', lang, false);
    }
    setLoading(false);
  }, [churchId, lang]);

  useEffect(() => { load(); }, [load]);

  const options = branches.filter((b) => b.id !== currentBranchId);
  const hasBranch = !!currentBranchId;

  // Self-pick (no branch yet) — applies immediately, no approval.
  const pickBranch = async (branchId: string) => {
    setBusy(true);
    try {
      await apiFetch('/api/v1/me', { method: 'PATCH', body: { branchId } });
      await refreshProfile?.();
      Alert.alert(t(lang, 'branchSaved'));
      await load();
    } catch (err: any) {
      Alert.alert(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  // Request a switch (has a branch) — needs pastor approval.
  const sendRequest = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await apiFetch('/api/v1/me/branch-change', {
        method: 'POST',
        body: { toBranchId: selected, reason: reason.trim() || undefined },
      });
      setSelected(null);
      setReason('');
      await load();
    } catch (err: any) {
      Alert.alert(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.outer, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chev" size={18} color={c.textSoft} />
          </View>
        </Pressable>
        <ThemedText type="subtitle" colorType="text" isAmharic={isAm}>
          {t(lang, 'branchChangeTitle')}
        </ThemedText>
        <View style={{ width: 18 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          {/* Current branch */}
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.label, { color: c.textFaint }]}>{t(lang, 'yourBranch')}</Text>
            <Text style={[styles.branchName, { color: c.text }, isAm && { fontFamily: fonts.amBold }]}>
              {currentBranchName || t(lang, 'noBranchYet')}
            </Text>
          </View>

          {/* Pending banner */}
          {pending && (
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.accent }]}>
              <Text style={[styles.body, { color: c.text }]}>{t(lang, 'branchChangePending')}</Text>
              <Text style={[styles.body, { color: c.accent, marginTop: 4 }]}>
                {t(lang, 'branchChangePendingTo').replace('%s', pending.toBranchName)}
              </Text>
            </View>
          )}

          {/* Action: self-pick (no branch) or request (has branch), hidden while a request is pending */}
          {!pending && (
            <View style={{ gap: space.sm }}>
              <Text style={[styles.section, { color: c.text }, isAm && { fontFamily: fonts.amBold }]}>
                {hasBranch ? t(lang, 'requestBranchChange') : t(lang, 'pickBranch')}
              </Text>
              <Text style={[styles.note, { color: c.textFaint }]}>
                {hasBranch ? t(lang, 'requestBranchNote') : t(lang, 'pickBranchNote')}
              </Text>

              {options.length === 0 ? (
                <Text style={[styles.note, { color: c.textFaint }]}>—</Text>
              ) : options.map((b) => {
                const on = selected === b.id;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => (hasBranch ? setSelected(on ? null : b.id) : pickBranch(b.id))}
                    disabled={busy}
                    style={[
                      styles.opt,
                      { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.surfaceAlt : c.surface },
                    ]}
                  >
                    <Text style={[styles.optText, { color: c.text }, isAm && { fontFamily: fonts.am }]}>
                      {isAm ? b.name_am : b.name_en}
                    </Text>
                    {hasBranch && on && <Icon name="check" size={16} color={c.accent} />}
                  </Pressable>
                );
              })}

              {hasBranch && selected && (
                <>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder={t(lang, 'changeReasonPlaceholder')}
                    placeholderTextColor={c.textFaint}
                    style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }]}
                    multiline
                  />
                  <Pressable
                    onPress={sendRequest}
                    disabled={busy}
                    style={[styles.btn, { backgroundColor: c.text, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.btnText, { color: c.bg }]}>
                      {busy ? t(lang, 'sending') : t(lang, 'sendRequest')}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {/* History */}
          {history && history.past.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Text style={[styles.section, { color: c.text }, isAm && { fontFamily: fonts.amBold }]}>
                {t(lang, 'branchHistoryLabel')}
              </Text>
              {history.past.map((p, i) => (
                <View key={i} style={[styles.histRow, { borderColor: c.border }]}>
                  <Text style={[styles.optText, { color: c.textSoft }, isAm && { fontFamily: fonts.am }]}>
                    {p.branchName}
                  </Text>
                  <Text style={[styles.tag, { color: c.textFaint, borderColor: c.border }]}>
                    {t(lang, 'formerBranchTag')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  branchName: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 16, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 19 },
  body: { fontSize: 14, lineHeight: 20 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 15 },
  optText: { fontSize: 15 },
  input: { borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  btn: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText: { fontSize: 15, fontWeight: '700' },
  histRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 15 },
  tag: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
});
