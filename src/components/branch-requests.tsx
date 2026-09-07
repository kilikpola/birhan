import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { apiFetch } from '@/lib/api';
import { t, type Lang } from '@/i18n';
import { radius, space, fonts, type Palette } from '@/theme/tokens';
import { reportError } from '@/lib/errors';

type Req = {
  id: string;
  memberName: string | null;
  fromBranchName: string | null;
  toBranchName: string;
  reason: string | null;
};

/**
 * Pending branch-change requests for a pastor/admin of the church. Shown at the
 * top of the pastor's member roster. Approving moves the member; the roster is
 * asked to refresh via onChanged.
 */
export function BranchRequests({ c, lang, onChanged }: { c: Palette; lang: Lang; onChanged?: () => void }) {
  const isAm = lang === 'am';
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ requests: Req[] }>('/api/v1/members/branch-change-requests?status=pending');
      setReqs(data.requests ?? []);
    } catch (err) {
      reportError(err, 'BranchRequests.load', lang, false);
      setReqs([]);
    }
    setLoading(false);
  }, [lang]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/v1/members/branch-change-requests/${id}/approve`, { method: 'POST' });
      await load();
      onChanged?.();
    } catch (err: any) {
      Alert.alert(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/v1/members/branch-change-requests/${id}/reject`, {
        method: 'POST',
        body: { reason: reason.trim() || (isAm ? 'አልጸደቀም' : 'Not approved') },
      });
      setRejectingId(null);
      setReason('');
      await load();
    } catch (err: any) {
      Alert.alert(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <View style={{ padding: space.md }}><ActivityIndicator color={c.accent} /></View>;
  }
  if (reqs.length === 0) return null; // nothing pending → take no space

  return (
    <View style={{ gap: space.sm, marginBottom: space.md }}>
      <Text style={[styles.title, { color: c.text }, isAm && { fontFamily: fonts.amBold }]}>
        {t(lang, 'branchRequestsTitle')}
      </Text>
      {reqs.map((r) => (
        <View key={r.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.name, { color: c.text }, isAm && { fontFamily: fonts.amBold }]}>{r.memberName ?? '—'}</Text>
          <Text style={[styles.move, { color: c.textSoft }]}>
            {t(lang, 'requestMovedFromTo').replace('%1', r.fromBranchName ?? '—').replace('%2', r.toBranchName)}
          </Text>
          {r.reason ? <Text style={[styles.reason, { color: c.textFaint }]}>“{r.reason}”</Text> : null}

          {rejectingId === r.id ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder={t(lang, 'rejectReasonPrompt')}
                placeholderTextColor={c.textFaint}
                style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.border }]}
              />
              <View style={styles.actions}>
                <Pressable onPress={() => { setRejectingId(null); setReason(''); }} style={[styles.btn, { borderColor: c.border }]}>
                  <Text style={{ color: c.textSoft, fontWeight: '600' }}>{t(lang, 'cancelLabel')}</Text>
                </Pressable>
                <Pressable onPress={() => reject(r.id)} disabled={busyId === r.id} style={[styles.btn, { borderColor: c.danger }]}>
                  <Text style={{ color: c.danger, fontWeight: '700' }}>{t(lang, 'rejectLabel')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={[styles.actions, { marginTop: space.sm }]}>
              <Pressable onPress={() => setRejectingId(r.id)} disabled={busyId === r.id} style={[styles.btn, { borderColor: c.danger }]}>
                <Text style={{ color: c.danger, fontWeight: '700' }}>{t(lang, 'rejectLabel')}</Text>
              </Pressable>
              <Pressable onPress={() => approve(r.id)} disabled={busyId === r.id} style={[styles.btn, { borderColor: c.success, backgroundColor: c.surfaceAlt }]}>
                <Text style={{ color: c.success, fontWeight: '700' }}>{t(lang, 'approveLabel')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  name: { fontSize: 15, fontWeight: '700' },
  move: { fontSize: 14, marginTop: 3 },
  reason: { fontSize: 13, marginTop: 4, fontStyle: 'italic' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  btn: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 16 },
  input: { borderWidth: 1, borderRadius: radius.md, padding: 10, fontSize: 14 },
});
