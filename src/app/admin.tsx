import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';

import { useApp } from '../theme/context';
import { t } from '../i18n';
import { fonts, radius, space } from '../theme/tokens';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import {
  useAnnouncements,
  publishAnnouncement,
  deleteAnnouncement,
  deleteReply,
  fetchReplies,
  toggleLock,
  Announcement,
  Reply,
} from '../lib/announcements';
import {
  uploadResource,
  deleteResource,
  fetchResourcesList,
  getChurchStorageUsed,
  Resource,
  ResourceCategory,
} from '../lib/resources';
import { TelegramSettings } from '../components/telegram-settings';
import { getTelegramLinkStatus, postAnnouncementToTelegram } from '../lib/telegram';
import { Icon } from '../components/icon';
import { Cross } from '../components/cross';
import { reportError } from '../lib/errors';
import { AdminSkeleton } from '../components/skeletons/admin-skeleton';
import { SectionBoundary } from '../components/section-boundary';

/**
 * Pastor Admin Panel Screen.
 * Includes Roster, Announcements, and Church Resources management.
 */
export default function AdminScreen() {
  const { c: colors, lang } = useApp();
  const { profile, isPastor } = useAuth();
  const { items: anns, online, reload: reloadAnns } = useAnnouncements();

  const [activeTab, setActiveTab] = useState<
    'roster' | 'compose' | 'announcements' | 'resources' | 'telegram'
  >('roster');

  // Telegram States
  const [isTelegramLinked, setIsTelegramLinked] = useState(false);
  const [postToTelegram, setPostToTelegram] = useState(true);

  // Check Telegram link status when church_id changes
  useEffect(() => {
    if (profile?.church_id) {
      getTelegramLinkStatus().then((status) => {
        setIsTelegramLinked(status.isLinked);
        setPostToTelegram(status.isLinked);
      });
    }
  }, [profile?.church_id]);

  // Roster States
  const [members, setMembers] = useState<any[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Compose States
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [postingAnn, setPostingAnn] = useState(false);

  // Manage Replies States
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);

  // Resource Upload & Storage States
  const [churchResources, setChurchResources] = useState<Resource[]>([]);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number>(0);
  const [loadingResources, setLoadingResources] = useState(false);

  // Resource Form States
  const [resFile, setResFile] = useState<any>(null);
  const [resTitleAm, setResTitleAm] = useState('');
  const [resTitleEn, setResTitleEn] = useState('');
  const [resCategory, setResCategory] = useState<ResourceCategory>('sermon_notes');
  const [resDesc, setResDesc] = useState('');
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [uploadingRes, setUploadingRes] = useState(false);

  const isAm = lang === 'am';

  // Access Control check
  if (!isPastor) {
    return (
      <SafeAreaView style={[s.wrap, { backgroundColor: colors.bg }]}>
        <View style={s.denied}>
          <Icon name="lock" size={32} color={colors.danger} />
          <Text style={[s.deniedText, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
            {isAm ? 'ፈቃድ የለዎትም' : 'Access Denied'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Load Members
  const loadMembers = useCallback(async () => {
    if (!profile?.church_id) return;
    setLoadingMembers(true);
    try {
      // One call gives both the page of members and the DB-counted total —
      // replaces the old two-query (churches.member_count + profiles list)
      // pattern.
      const res = await apiFetch<{ members: any[]; total: number }>('/api/v1/members?limit=200');
      setMemberCount(res.total);
      setMembers(
        res.members.map((m) => ({
          id: m.id,
          display_name: m.displayName,
          role: m.role,
          branch_name: m.branchName ?? null,
          created_at: m.createdAt,
        })),
      );
    } catch (err) {
      reportError(err, 'Admin.loadMembers', lang, false);
    } finally {
      setLoadingMembers(false);
    }
  }, [profile?.church_id, lang]);

  useEffect(() => {
    if (activeTab === 'roster') {
      loadMembers();
    }
  }, [activeTab, loadMembers]);

  // Load Resources and Storage Usage
  const loadChurchResources = useCallback(async () => {
    if (!profile?.church_id) return;
    setLoadingResources(true);
    try {
      const list = await fetchResourcesList(profile.church_id);
      setChurchResources(list);
      const bytes = await getChurchStorageUsed(profile.church_id);
      setStorageUsedBytes(bytes);
    } catch (err) {
      reportError(err, 'Admin.loadChurchResources', lang, false);
    } finally {
      setLoadingResources(false);
    }
  }, [profile?.church_id, lang]);

  useEffect(() => {
    if (activeTab === 'resources') {
      loadChurchResources();
    }
  }, [activeTab, loadChurchResources]);

  // Load Replies for Open Announcement
  const loadReplies = useCallback(async () => {
    if (!selectedAnnId) return;
    setLoadingReplies(true);
    try {
      const data = await fetchReplies(selectedAnnId);
      setReplies(data);
    } catch (err) {
      reportError(err, 'Admin.loadReplies', lang, false);
    } finally {
      setLoadingReplies(false);
    }
  }, [selectedAnnId, lang]);

  useEffect(() => {
    loadReplies();
  }, [loadReplies]);

  // Post Announcement
  const handlePostAnn = async () => {
    if (!annTitle.trim() || !annBody.trim() || !profile?.church_id || !profile?.id) return;
    setPostingAnn(true);
    const shouldPostTelegram = isTelegramLinked && postToTelegram;
    const titleStr = annTitle.trim();
    const bodyStr = annBody.trim();
    const churchIdStr = profile.church_id;

    const res = await publishAnnouncement({
      churchId: churchIdStr,
      authorId: profile.id,
      title: titleStr,
      body: bodyStr,
      postToTelegram: shouldPostTelegram,
    });
    setPostingAnn(false);
    if (res.error) {
      reportError(res.error, 'Admin.handlePostAnn', lang);
    } else {
      setAnnTitle('');
      setAnnBody('');
      reloadAnns();
      setActiveTab('announcements');

      if (res.telegramSuccess === false && res.data?.id) {
        const createdAnnId = res.data.id;
        Alert.alert(
          isAm ? 'ማሳሰቢያ' : 'Telegram Notice',
          t(lang, 'telegramFailedRetryPrompt'),
          [
            { text: isAm ? 'ተው' : 'Dismiss', style: 'cancel' },
            {
              text: t(lang, 'btnRetryTelegram'),
              onPress: async () => {
                const retryRes = await postAnnouncementToTelegram({
                  announcementId: createdAnnId,
                  churchId: churchIdStr,
                  title: titleStr,
                  body: bodyStr,
                });
                if (retryRes.success) {
                  reloadAnns();
                } else if (retryRes.error) {
                  reportError(retryRes.error, 'Admin.retryTelegram', lang);
                }
              },
            },
          ]
        );
      }
    }
  };

  // Toggle Lock
  const handleToggleLock = async (ann: Announcement) => {
    await toggleLock(ann.id, !ann.locked);
    reloadAnns();
  };

  // Delete Announcement with Telegram disclaimer
  const handleDeleteAnn = async (annId: string) => {
    Alert.alert(
      t(lang, 'delete'),
      `${isAm ? 'ይህንን ማስታወቂያ ለመሰረዝ እርግጠኛ ነዎት?' : 'Are you sure you want to delete this announcement?'}\n\n${t(lang, 'telegramDeleteDisclaimer')}`,
      [
        { text: isAm ? 'ሰርዝ' : 'Cancel', style: 'cancel' },
        {
          text: t(lang, 'delete'),
          style: 'destructive',
          onPress: async () => {
            const res = await deleteAnnouncement(annId);
            if (res.error) {
              reportError(new Error(res.error), 'Admin.handleDeleteAnn', lang);
            } else {
              if (selectedAnnId === annId) setSelectedAnnId(null);
              reloadAnns();
            }
          },
        },
      ]
    );
  };

  // Delete Reply
  const handleDeleteReply = async (replyId: string) => {
    const res = await deleteReply(replyId);
    if (res.error) {
      reportError(new Error(res.error), 'Admin.handleDeleteReply', lang);
    } else {
      loadReplies();
      reloadAnns();
    }
  };

  // Pick Document for Resources
  const pickResourceDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setResFile(result.assets[0]);
      }
    } catch (err) {
      reportError(err, 'Admin.pickResourceDocument', lang);
    }
  };

  // Upload Resource Handler
  const handleUploadResource = async () => {
    if (!rightsConfirmed || !resFile || !profile?.church_id || !profile?.id) return;
    if (!resTitleAm.trim() && !resTitleEn.trim()) return;

    setUploadingRes(true);
    try {
      const res = await uploadResource({
        churchId: profile.church_id,
        uploadedBy: profile.id,
        branchId: (profile as any).branch_id || null,
        titleAm: resTitleAm.trim(),
        titleEn: resTitleEn.trim(),
        description: resDesc.trim(),
        category: resCategory,
        rightsConfirmed: true,
        fileUri: resFile.uri,
        fileName: resFile.name || 'document.pdf',
        fileSize: resFile.size || 0,
        mimeType: resFile.mimeType || 'application/pdf',
      });

      if (res.error) {
        reportError(res.error, 'Admin.handleUploadResource', lang);
      } else {
        setResFile(null);
        setResTitleAm('');
        setResTitleEn('');
        setResDesc('');
        setRightsConfirmed(false);
        await loadChurchResources();
      }
    } catch (err) {
      reportError(err, 'Admin.handleUploadResource', lang);
    } finally {
      setUploadingRes(false);
    }
  };

  // Delete Resource Handler
  const handleDeleteResource = async (item: Resource) => {
    try {
      const { error } = await deleteResource(item);
      if (error) {
        reportError(error, 'Admin.handleDeleteResource', lang);
      } else {
        await loadChurchResources();
      }
    } catch (err) {
      reportError(err, 'Admin.handleDeleteResource', lang);
    }
  };

  const currentAnn = anns.find((a) => a.id === selectedAnnId);
  const formattedStorage = (storageUsedBytes / (1024 * 1024)).toFixed(1);

  const categories: { id: ResourceCategory; labelKey: any }[] = [
    { id: 'sermon_notes', labelKey: 'catSermonNotes' },
    { id: 'study_guide', labelKey: 'catStudyGuide' },
    { id: 'calendar', labelKey: 'catCalendar' },
    { id: 'announcement_doc', labelKey: 'catAnnouncementDoc' },
    { id: 'other', labelKey: 'catOther' },
  ];

  return (
    <SafeAreaView style={[s.wrap, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      {/* Title */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Text style={[s.title, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
          {t(lang, 'admin')}
        </Text>
      </View>

      {/* Tabs */}
      {!selectedAnnId && (
        <View style={[s.tabs, { borderBottomColor: colors.border }]}>
          <Pressable
            onPress={() => setActiveTab('roster')}
            style={[s.tab, activeTab === 'roster' && { borderBottomColor: colors.accent }]}
          >
            <Text style={[s.tabText, { color: activeTab === 'roster' ? colors.accent : colors.textSoft, fontFamily: isAm ? fonts.amBold : undefined }]}>
              {t(lang, 'memberRoster')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('compose')}
            style={[s.tab, activeTab === 'compose' && { borderBottomColor: colors.accent }]}
          >
            <Text style={[s.tabText, { color: activeTab === 'compose' ? colors.accent : colors.textSoft, fontFamily: isAm ? fonts.amBold : undefined }]}>
              {isAm ? 'መጻፍ' : 'Compose'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('announcements')}
            style={[s.tab, activeTab === 'announcements' && { borderBottomColor: colors.accent }]}
          >
            <Text style={[s.tabText, { color: activeTab === 'announcements' ? colors.accent : colors.textSoft, fontFamily: isAm ? fonts.amBold : undefined }]}>
              {t(lang, 'announcement')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('resources')}
            style={[s.tab, activeTab === 'resources' && { borderBottomColor: colors.accent }]}
          >
            <Text style={[s.tabText, { color: activeTab === 'resources' ? colors.accent : colors.textSoft, fontFamily: isAm ? fonts.amBold : undefined }]}>
              {t(lang, 'resources')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('telegram')}
            style={[s.tab, activeTab === 'telegram' && { borderBottomColor: colors.accent }]}
          >
            <Text style={[s.tabText, { color: activeTab === 'telegram' ? colors.accent : colors.textSoft, fontFamily: isAm ? fonts.amBold : undefined }]}>
              {isAm ? 'ቴሌግራም' : 'Telegram'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Content area */}
      <ScrollView contentContainerStyle={s.content}>
        {selectedAnnId && currentAnn ? (
          /* ANNOUNCEMENT REPLIES MANAGER SUB-VIEW */
          <View>
            <Pressable
              onPress={() => setSelectedAnnId(null)}
              style={s.backBtn}
              hitSlop={12}
            >
              <Icon name="back" size={18} color={colors.accent} />
              <Text style={[s.backText, { color: colors.accent, fontFamily: isAm ? fonts.amBold : undefined }]}>
                {isAm ? 'ተመለስ' : 'Back'}
              </Text>
            </Pressable>

            {/* Announcement Card */}
            <SectionBoundary name="Admin.AnnouncementDetail">
              <View style={[s.manuscript, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={[s.spine, { backgroundColor: colors.accent }]} />
                <View style={s.detailHeader}>
                  <Cross size={12} color={colors.accent} />
                  <Text style={[s.eyebrow, { color: colors.accent, marginLeft: 6 }]}>
                    {isAm ? 'ማስታወቂያ' : 'Announcement'}
                  </Text>
                </View>
                <Text style={[s.detailTitle, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
                  {isAm ? currentAnn.title_am : currentAnn.title_en}
                </Text>
                <Text style={[s.detailBody, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}>
                  {currentAnn.body}
                </Text>

                <View style={s.annActionRow}>
                  <Pressable
                    onPress={() => handleToggleLock(currentAnn)}
                    style={[s.chip, currentAnn.locked && s.chipWarn, { borderColor: currentAnn.locked ? colors.danger : colors.border }]}
                  >
                    <Icon name="lock" size={10} color={currentAnn.locked ? colors.danger : colors.textSoft} />
                    <Text style={[s.chipText, { color: currentAnn.locked ? colors.danger : colors.textSoft, marginLeft: 4 }]}>
                      {currentAnn.locked ? (isAm ? 'ክፈት' : 'Unlock Thread') : (isAm ? 'ቆልፍ' : 'Lock Thread')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteAnn(currentAnn.id)}
                    style={[s.chip, s.chipWarn, { borderColor: colors.danger }]}
                  >
                    <Icon name="lock" size={10} color={colors.danger} />
                    <Text style={[s.chipText, { color: colors.danger, marginLeft: 4 }]}>
                      {t(lang, 'delete')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </SectionBoundary>

            {/* Replies List */}
            <SectionBoundary name="Admin.RepliesList" onRetry={loadReplies}>
              <View style={s.divider}>
                <Text style={[s.dividerLabel, { color: colors.textFaint }]}>
                  {t(lang, 'replies')} ({replies.length})
                </Text>
                <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              {loadingReplies && replies.length === 0 ? (
                <AdminSkeleton count={3} />
              ) : (
                replies.map((r) => (
                  <View key={r.id} style={[s.replyCard, { borderLeftColor: colors.border }]}>
                    <View style={s.replyHeader}>
                      <Text style={[s.replyAuthor, { color: colors.text }]}>{r.author_name}</Text>
                      <Pressable onPress={() => handleDeleteReply(r.id)} hitSlop={10}>
                        <Text style={[s.deleteBtnText, { color: colors.danger }]}>
                          {t(lang, 'delete')}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={[s.replyText, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}>
                      {r.text}
                    </Text>
                  </View>
                ))
              )}
            </SectionBoundary>
          </View>
        ) : (
          /* MAIN TABS */
          <View>
            {activeTab === 'roster' && (
              /* MEMBER ROSTER TAB */
              <SectionBoundary name="Admin.Roster" onRetry={loadMembers}>
                <View>
                  <View style={[s.manuscript, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: space.md }]}>
                    <View style={[s.spine, { backgroundColor: colors.accent }]} />
                    <Text style={[s.eyebrow, { color: colors.accent }]}>
                      {isAm ? 'ጠቅላላ የአባላት ብዛት' : 'Total Members'}
                    </Text>
                    <Text style={[s.countNumber, { color: colors.text }]}>
                      {memberCount} {isAm ? 'አባላት' : 'members'}
                    </Text>
                  </View>

                  <View style={s.divider}>
                    <Text style={[s.dividerLabel, { color: colors.textFaint }]}>
                      {t(lang, 'memberRoster')}
                    </Text>
                    <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
                  </View>

                  {loadingMembers && members.length === 0 ? (
                    <AdminSkeleton count={5} />
                  ) : (
                    members.map((m) => (
                      <View key={m.id} style={[s.row, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                        <View style={[s.avatar, { backgroundColor: colors.accentDim }]}>
                          <Icon name="user" size={18} color={colors.bg} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[s.memberName, { color: colors.text }]}>{m.display_name}</Text>
                          <Text style={[s.memberBranch, { color: colors.textFaint }]}>
                            {m.branch_name ? (isAm ? `${m.branch_name} ቅርንጫፍ` : `${m.branch_name} Branch`) : (isAm ? 'ቅርንጫፍ አልተጠቀሰም' : 'No branch specified')}
                          </Text>
                        </View>
                        <View style={[s.badge, { borderColor: colors.accent }]}>
                          <Text style={[s.badgeText, { color: colors.accent }]}>
                            {m.role === 'pastor' ? (isAm ? 'እረኛ' : 'Pastor') : m.role === 'admin' ? (isAm ? 'አስተዳዳሪ' : 'Admin') : (isAm ? 'አባል' : 'Member')}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </SectionBoundary>
            )}

            {activeTab === 'compose' && (
              /* POST ANNOUNCEMENT TAB */
              <SectionBoundary name="Admin.Compose">
                <View style={[s.manuscript, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[s.spine, { backgroundColor: colors.accent }]} />
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="gear" size={12} color={colors.accent} />
                    <Text style={[s.eyebrow, { color: colors.accent, marginLeft: 6, fontFamily: isAm ? fonts.amBold : undefined }]}>
                      {t(lang, 'newAnnouncement')}
                    </Text>
                  </View>

                  <TextInput
                    style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                    placeholder={t(lang, 'announcementTitle')}
                    placeholderTextColor={colors.textFaint}
                    value={annTitle}
                    onChangeText={setAnnTitle}
                  />
                  <TextInput
                    style={[s.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                    multiline
                    placeholder={t(lang, 'announcementBody')}
                    placeholderTextColor={colors.textFaint}
                    value={annBody}
                    onChangeText={setAnnBody}
                  />

                  <View style={{ flexDirection: 'row', gap: 6, marginVertical: 8 }}>
                    <View style={[s.chip, s.chipOn, { borderColor: colors.success }]}>
                      <Text style={[s.chipText, { color: colors.success }]}>
                        {isAm ? 'ለሁሉም አባላት ይላካል' : 'Will Push to All Members'}
                      </Text>
                    </View>
                    {!online && (
                      <View style={[s.chip, s.chipWarn, { borderColor: colors.danger }]}>
                        <Text style={[s.chipText, { color: colors.danger }]}>
                          {t(lang, 'pending')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {isTelegramLinked && (
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}
                      onPress={() => setPostToTelegram(!postToTelegram)}
                    >
                      <View
                        style={[
                          s.checkbox,
                          {
                            borderColor: postToTelegram ? colors.accent : colors.border,
                            backgroundColor: postToTelegram ? colors.accent : colors.bg,
                          },
                        ]}
                      >
                        {postToTelegram && <Icon name="check" size={12} color={colors.bg} />}
                      </View>
                      <Text style={[s.checkboxLabel, { color: colors.text, fontFamily: isAm ? fonts.am : undefined, marginLeft: 8 }]}>
                        {t(lang, 'cbAlsoPostTelegram')}
                      </Text>
                    </Pressable>
                  )}

                  <Pressable
                    style={[s.btn, { backgroundColor: colors.text }]}
                    onPress={handlePostAnn}
                    disabled={postingAnn || !annTitle.trim() || !annBody.trim()}
                  >
                    {postingAnn ? (
                      <ActivityIndicator color={colors.bg} />
                    ) : (
                      <>
                        <Icon name="send" size={14} color={colors.bg} />
                        <Text style={[s.btnText, { color: colors.bg }]}>
                          {online ? t(lang, 'post') : t(lang, 'pending')}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </SectionBoundary>
            )}

            {activeTab === 'announcements' && (
              /* MY ANNOUNCEMENTS TAB */
              <SectionBoundary name="Admin.Announcements" onRetry={reloadAnns}>
                <View>
                  {anns.length === 0 ? (
                    <View style={[s.emptyContainer, { borderColor: colors.border }]}>
                      <Text style={[s.emptyText, { color: colors.textFaint }]}>
                        {isAm ? 'ምንም ማስታወቂያ የለም' : 'No announcements posted.'}
                      </Text>
                    </View>
                  ) : (
                    anns.map((a) => (
                      <Pressable
                        key={a.id}
                        style={[s.annRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
                        onPress={() => setSelectedAnnId(a.id)}
                      >
                        <View style={s.annRowHeader}>
                          <Text style={[s.annRowTitle, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
                            {isAm ? a.title_am : a.title_en}
                          </Text>
                          {a.locked && <Icon name="lock" size={12} color={colors.danger} />}
                        </View>
                        <Text
                          style={[s.annRowBody, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}
                          numberOfLines={2}
                        >
                          {a.body}
                        </Text>
                        <View style={s.annRowFooter}>
                          <Text style={[s.annRowMeta, { color: colors.textFaint }]}>
                            {new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </Text>
                          <View style={[s.chip, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                            <Icon name="reply" size={10} color={colors.textSoft} />
                            <Text style={[s.chipText, { color: colors.textSoft, marginLeft: 4 }]}>
                              {a.reply_count ?? 0} {t(lang, 'replies')}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              </SectionBoundary>
            )}

            {activeTab === 'resources' && (
              /* CHURCH RESOURCES MANAGEMENT TAB */
              <SectionBoundary name="Admin.Resources" onRetry={loadChurchResources}>
                <View>
                  {/* Total Storage Used Box */}
                  <View style={[s.manuscript, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: space.md }]}>
                    <View style={[s.spine, { backgroundColor: colors.accent }]} />
                    <Text style={[s.eyebrow, { color: colors.accent }]}>
                      {t(lang, 'totalStorageUsed')}
                    </Text>
                    <Text style={[s.countNumber, { color: colors.text }]}>
                      {formattedStorage} MB
                    </Text>
                  </View>

                  {/* Upload Form Card */}
                  <View style={[s.manuscript, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: space.lg }]}>
                    <View style={[s.spine, { backgroundColor: colors.accent }]} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <Icon name="gear" size={12} color={colors.accent} />
                      <Text style={[s.eyebrow, { color: colors.accent, marginLeft: 6, fontFamily: isAm ? fonts.amBold : undefined }]}>
                        {t(lang, 'uploadResource')}
                      </Text>
                    </View>

                    {/* File Picker */}
                    <Pressable
                      style={[s.filePickerBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
                      onPress={pickResourceDocument}
                    >
                      <Icon name="book" size={16} color={colors.accent} />
                      <Text style={[s.filePickerText, { color: colors.text }]} numberOfLines={1}>
                        {resFile ? resFile.name : t(lang, 'pickFile')}
                      </Text>
                    </Pressable>

                    {/* Title Amharic */}
                    <TextInput
                      style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                      placeholder={t(lang, 'docTitleAm')}
                      placeholderTextColor={colors.textFaint}
                      value={resTitleAm}
                      onChangeText={setResTitleAm}
                    />

                    {/* Title English */}
                    <TextInput
                      style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                      placeholder={t(lang, 'docTitleEn')}
                      placeholderTextColor={colors.textFaint}
                      value={resTitleEn}
                      onChangeText={setResTitleEn}
                    />

                    {/* Category Selection */}
                    <Text style={[s.label, { color: colors.accent, marginTop: 8 }]}>
                      {t(lang, 'selectCategory')}
                    </Text>
                    <View style={s.catPillContainer}>
                      {categories.map((cItem) => {
                        const isSel = resCategory === cItem.id;
                        return (
                          <Pressable
                            key={cItem.id}
                            onPress={() => setResCategory(cItem.id)}
                            style={[
                              s.catPill,
                              {
                                borderColor: isSel ? colors.accent : colors.border,
                                backgroundColor: isSel ? colors.accent : colors.bg,
                              },
                            ]}
                          >
                            <Text style={[s.catPillText, { color: isSel ? colors.bg : colors.textSoft }]}>
                              {t(lang, cItem.labelKey)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Description */}
                    <TextInput
                      style={[s.textarea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                      multiline
                      placeholder={t(lang, 'description')}
                      placeholderTextColor={colors.textFaint}
                      value={resDesc}
                      onChangeText={setResDesc}
                    />

                    {/* Licensing Confirmation Checkbox */}
                    <Pressable
                      style={s.checkboxRow}
                      onPress={() => setRightsConfirmed(!rightsConfirmed)}
                    >
                      <View style={[s.checkbox, { borderColor: rightsConfirmed ? colors.accent : colors.border, backgroundColor: rightsConfirmed ? colors.accent : colors.bg }]}>
                        {rightsConfirmed && <Icon name="check" size={12} color={colors.bg} />}
                      </View>
                      <Text style={[s.checkboxLabel, { color: colors.text, fontFamily: isAm ? fonts.am : undefined }]}>
                        {t(lang, 'rightsConfirmation')} *
                      </Text>
                    </Pressable>

                    {/* Third Party Prohibitive Notice */}
                    <View style={[s.noticeBox, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                      <Text style={[s.noticeText, { color: colors.textFaint, fontFamily: isAm ? fonts.am : undefined }]}>
                        {t(lang, 'thirdPartyNotice')}
                      </Text>
                    </View>

                    {/* Submit Button */}
                    <Pressable
                      style={[
                        s.btn,
                        {
                          backgroundColor: rightsConfirmed && resFile && (resTitleAm.trim() || resTitleEn.trim()) ? colors.text : colors.border,
                        },
                      ]}
                      onPress={handleUploadResource}
                      disabled={uploadingRes || !rightsConfirmed || !resFile || (!resTitleAm.trim() && !resTitleEn.trim())}
                    >
                      {uploadingRes ? (
                        <ActivityIndicator color={colors.bg} />
                      ) : (
                        <>
                          <Icon name="send" size={14} color={colors.bg} />
                          <Text style={[s.btnText, { color: colors.bg }]}>
                            {t(lang, 'uploadResource')}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>

                  {/* Church Uploaded Documents List */}
                  <View style={s.divider}>
                    <Text style={[s.dividerLabel, { color: colors.textFaint }]}>
                      {t(lang, 'resources')} ({churchResources.length})
                    </Text>
                    <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
                  </View>

                  {loadingResources && churchResources.length === 0 ? (
                    <AdminSkeleton count={3} />
                  ) : churchResources.length === 0 ? (
                    <View style={[s.emptyContainer, { borderColor: colors.border }]}>
                      <Text style={[s.emptyText, { color: colors.textFaint }]}>
                        {t(lang, 'noDocumentsYet')}
                      </Text>
                    </View>
                  ) : (
                    churchResources.map((item) => {
                      const title = (isAm ? item.title_am || item.title_en : item.title_en || item.title_am) || 'Untitled Document';
                      const sizeMB = (item.file_size_bytes / (1024 * 1024)).toFixed(1);

                      return (
                        <View
                          key={item.id}
                          style={[s.annRow, { borderColor: colors.border, backgroundColor: colors.surface }]}
                        >
                          <View style={s.annRowHeader}>
                            <Text style={[s.annRowTitle, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
                              {title}
                            </Text>
                            <Pressable onPress={() => handleDeleteResource(item)} hitSlop={10}>
                              <Text style={[s.deleteBtnText, { color: colors.danger }]}>
                                {t(lang, 'delete')}
                              </Text>
                            </Pressable>
                          </View>

                          {item.description ? (
                            <Text
                              style={[s.annRowBody, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}
                              numberOfLines={2}
                            >
                              {item.description}
                            </Text>
                          ) : null}

                          <View style={s.annRowFooter}>
                            <Text style={[s.annRowMeta, { color: colors.textFaint }]}>
                              {sizeMB} MB · {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </Text>
                            <View style={[s.chip, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                              <Text style={[s.chipText, { color: colors.accent }]}>
                                {item.category}
                              </Text>
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              </SectionBoundary>
            )}

            {activeTab === 'telegram' && profile?.church_id && profile?.id && (
              <SectionBoundary name="Admin.Telegram">
                <TelegramSettings />
              </SectionBoundary>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 20, fontWeight: '700' },
  denied: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deniedText: { fontSize: 16, marginTop: 12, fontWeight: '600' },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 12, fontWeight: '600' },

  content: { padding: space.lg, paddingBottom: 40 },

  manuscript: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    paddingLeft: space.lg + 4,
    overflow: 'hidden',
    position: 'relative',
  },
  spine: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, opacity: 0.6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: '700', textTransform: 'uppercase' },

  countNumber: { fontSize: 24, fontWeight: '700', marginTop: space.sm },

  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 14 },
  dividerLabel: { fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '700' },
  dividerLine: { flex: 1, height: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberBranch: { fontSize: 12, marginTop: 2 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: { fontSize: 10, fontWeight: '600' },

  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 3,
    padding: 12,
    marginTop: 8,
    marginBottom: 10,
    gap: 8,
  },
  filePickerText: { fontSize: 13.5, flex: 1 },

  input: {
    borderWidth: 1,
    borderRadius: 3,
    padding: 10,
    marginTop: 8,
    fontSize: 14,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 3,
    padding: 10,
    marginTop: 8,
    fontSize: 14,
    height: 80,
    textAlignVertical: 'top',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 3,
    paddingVertical: 12,
    marginTop: 12,
  },
  btnText: { fontSize: 14, fontWeight: '600' },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  chipOn: { backgroundColor: 'rgba(78, 107, 74, 0.1)' },
  chipWarn: { backgroundColor: 'rgba(156, 49, 37, 0.1)' },

  catPillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 6,
  },
  catPill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  catPillText: { fontSize: 11, fontWeight: '600' },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },

  noticeBox: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    marginVertical: 6,
  },
  noticeText: {
    fontSize: 11.5,
    lineHeight: 16,
  },

  emptyContainer: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    marginBottom: 10,
  },
  emptyText: { fontSize: 13, fontWeight: '500' },

  annRow: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
  },
  annRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  annRowTitle: { fontSize: 15, fontWeight: '600' },
  annRowBody: { fontSize: 13, lineHeight: 18 },
  annRowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  annRowMeta: { fontSize: 11 },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  backText: { fontSize: 15, fontWeight: '600' },

  detailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  detailTitle: { fontSize: 20, fontWeight: '700', marginVertical: 8, lineHeight: 28 },
  detailBody: { fontSize: 15, lineHeight: 24, marginVertical: 6 },
  annActionRow: { flexDirection: 'row', gap: 6, marginTop: 12 },

  replyCard: {
    borderLeftWidth: 2,
    paddingLeft: 12,
    marginVertical: 8,
    paddingVertical: 4,
  },
  replyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  replyAuthor: { fontSize: 13, fontWeight: '700' },
  deleteBtnText: { fontSize: 12, fontWeight: '600' },
  replyText: { fontSize: 13.5, lineHeight: 20, marginTop: 2 },
});
