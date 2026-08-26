import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Modal,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { useApp } from '../theme/context';
import { t } from '../i18n';
import { fonts, radius, space } from '../theme/tokens';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/errors';
import { Icon } from '../components/icon';

type Filter = 'pending' | 'approved' | 'rejected';

type PendingProfile = {
  id: string;
  display_name: string;
  church_id: string | null;
  branch_name: string | null;
  church_role: string | null;
  pastor_status: 'pending' | 'approved' | 'rejected' | null;
  pastor_doc_path: string | null;
  pastor_rejected_reason: string | null;
  pastor_requested_at: string | null;
};

/**
 * Stage 3 — super_admin pastor verification queue.
 * Lists pending_pastor applicants with signed document URLs; approve or reject.
 */
export default function VerificationScreen() {
  const { c, lang } = useApp();
  const { isSuperAdmin } = useAuth();
  const isAm = lang === 'am';

  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<PendingProfile[]>([]);
  const [churchNames, setChurchNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingProfile | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, display_name, church_id, branch_name, church_role, pastor_status, pastor_doc_path, pastor_rejected_reason, pastor_requested_at',
      )
      .eq('pastor_status', filter)
      .order('pastor_requested_at', { ascending: true });

    if (error) {
      reportError(error, 'Verification.load', lang, false);
      setRows([]);
    } else {
      const list = (data as PendingProfile[]) ?? [];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.church_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: churches } = await supabase
          .from('churches')
          .select('id, name_en, name_am')
          .in('id', ids);
        const map: Record<string, string> = {};
        (churches ?? []).forEach((ch: { id: string; name_en: string; name_am: string }) => {
          map[ch.id] = isAm ? ch.name_am : ch.name_en;
        });
        setChurchNames(map);
      } else {
        setChurchNames({});
      }
    }
    setLoading(false);
  }, [filter, isAm, lang]);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <SafeAreaView style={[s.outer, { backgroundColor: c.bg }]}>
        <View style={s.denied}>
          <Text style={{ color: c.textSoft }}>{t(lang, 'errPermission')}</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: c.accent }}>{isAm ? '← ተመለስ' : '← Back'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const viewDoc = async (row: PendingProfile) => {
    if (!row.pastor_doc_path) return;
    const { data, error } = await supabase.storage
      .from('pastor-docs')
      .createSignedUrl(row.pastor_doc_path, 3600);
    if (error || !data?.signedUrl) {
      Alert.alert(t(lang, 'errGeneric'), error?.message ?? 'No URL');
      return;
    }
    try {
      await Linking.openURL(data.signedUrl);
    } catch {
      try {
        await WebBrowser.openBrowserAsync(data.signedUrl);
      } catch (err) {
        reportError(err, 'Verification.viewDoc', lang);
      }
    }
  };

  const approve = async (row: PendingProfile) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'pastor', pastor_status: 'approved', pastor_rejected_reason: null })
      .eq('id', row.id);
    setBusyId(null);
    if (error) {
      reportError(error, 'Verification.approve', lang);
    } else {
      Alert.alert(t(lang, 'verificationApproved'), t(lang, 'verificationSignOutNote'));
      load();
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    const { error } = await supabase
      .from('profiles')
      .update({
        role: 'member',
        pastor_status: 'rejected',
        pastor_rejected_reason: rejectReason.trim() || 'Not specified',
      })
      .eq('id', rejecting.id);
    setBusyId(null);
    setRejecting(null);
    setRejectReason('');
    if (error) {
      reportError(error, 'Verification.reject', lang);
    } else {
      load();
    }
  };

  return (
    <SafeAreaView style={[s.outer, { backgroundColor: c.bg }]}>
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icon name="chev" size={18} color={c.textSoft} />
          </View>
        </Pressable>
        <Text style={[s.title, { color: c.text }]}>{t(lang, 'verificationQueue')}</Text>
        <View style={{ width: 18 }} />
      </View>

      <Text style={[s.desc, { color: c.textSoft }]}>{t(lang, 'verificationQueueDesc')}</Text>

      <View style={s.filterRow}>
        {(['pending', 'approved', 'rejected'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              s.filterBtn,
              {
                backgroundColor: filter === f ? c.accent : c.surface,
                borderColor: filter === f ? c.accent : c.border,
              },
            ]}
          >
            <Text style={{ color: filter === f ? c.bg : c.textSoft, fontWeight: '600', fontSize: 13 }}>
              {t(lang, f === 'pending' ? 'verificationPending' : f === 'approved' ? 'verificationApproved' : 'verificationRejected')}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
      ) : rows.length === 0 ? (
        <Text style={[s.empty, { color: c.textFaint }]}>{t(lang, 'verificationEmpty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {rows.map((row) => (
            <View key={row.id} style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[s.name, { color: c.text }]}>{row.display_name}</Text>
              <Text style={[s.meta, { color: c.textSoft }]}>
                {row.church_id ? churchNames[row.church_id] ?? '—' : '—'}
                {row.branch_name ? ` · ${row.branch_name}` : ''}
                {row.church_role ? ` · ${row.church_role}` : ''}
                {row.pastor_requested_at
                  ? ` · ${t(lang, 'verificationApplied')} ${new Date(row.pastor_requested_at).toLocaleDateString()}`
                  : ''}
              </Text>
              {row.pastor_status === 'rejected' && row.pastor_rejected_reason ? (
                <Text style={[s.reason, { color: c.danger }]}>{row.pastor_rejected_reason}</Text>
              ) : null}

              <View style={s.actions}>
                <Pressable
                  onPress={() => viewDoc(row)}
                  disabled={!row.pastor_doc_path}
                  style={[s.actionBtn, { borderColor: c.border, opacity: row.pastor_doc_path ? 1 : 0.5 }]}
                >
                  <Text style={{ color: c.text, fontSize: 13 }}>
                    {row.pastor_doc_path ? t(lang, 'verificationViewDoc') : t(lang, 'verificationNoDoc')}
                  </Text>
                </Pressable>

                {filter === 'pending' && (
                  <>
                    <Pressable
                      onPress={() => approve(row)}
                      disabled={busyId === row.id}
                      style={[s.actionBtn, { backgroundColor: c.accent, borderColor: c.accent }]}
                    >
                      <Text style={{ color: c.bg, fontSize: 13, fontWeight: '600' }}>
                        {t(lang, 'verificationApprove')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setRejecting(row)}
                      disabled={busyId === row.id}
                      style={[s.actionBtn, { borderColor: c.danger }]}
                    >
                      <Text style={{ color: c.danger, fontSize: 13, fontWeight: '600' }}>
                        {t(lang, 'verificationReject')}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!rejecting} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={[s.modal, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[s.modalTitle, { color: c.text }]}>{t(lang, 'verificationRejectTitle')}</Text>
            <Text style={{ color: c.textSoft, marginBottom: 12 }}>{t(lang, 'verificationRejectNote')}</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder={t(lang, 'verificationRejectReason')}
              placeholderTextColor={c.textFaint}
              multiline
              style={[s.textArea, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => setRejecting(null)} style={s.modalBtn}>
                <Text style={{ color: c.textSoft }}>{isAm ? 'ይቅር' : 'Cancel'}</Text>
              </Pressable>
              <Pressable onPress={confirmReject} disabled={busyId === rejecting?.id} style={s.modalBtn}>
                <Text style={{ color: c.danger, fontWeight: '600' }}>{t(lang, 'verificationConfirmReject')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  outer: { flex: 1 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '700', fontFamily: fonts.uiBold },
  desc: { fontSize: 13, paddingHorizontal: space.lg, paddingTop: 12, lineHeight: 20 },
  filterRow: { flexDirection: 'row', gap: 8, padding: space.lg },
  filterBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  list: { paddingHorizontal: space.lg, paddingBottom: 40 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 14, marginBottom: 12 },
  name: { fontSize: 16, fontWeight: '600', fontFamily: fonts.uiBold },
  meta: { fontSize: 12.5, marginTop: 4, lineHeight: 18 },
  reason: { fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  modalBack: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modal: { borderRadius: radius.lg, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  textArea: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 16 },
  modalBtn: { padding: 8 },
});
