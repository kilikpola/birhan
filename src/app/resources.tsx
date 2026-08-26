import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../theme/context';
import { t } from '../i18n';
import { fonts, radius, space } from '../theme/tokens';
import { useAuth } from '../lib/auth';
import {
  useResources,
  openResource,
  checkLocalResource,
  downloadResource,
  Resource,
  ResourceCategory,
} from '../lib/resources';
import { Icon } from '../components/icon';
import { reportError } from '../lib/errors';
import { ResourceSkeleton } from '../components/skeletons/resource-skeleton';
import { SectionBoundary } from '../components/section-boundary';
import { useSkeleton } from '../lib/use-skeleton';

type CategoryFilter = 'all' | ResourceCategory;

export default function ResourcesScreen() {
  const { c: colors, lang } = useApp();
  const { profile } = useAuth();
  const { resources, loading, online, reload } = useResources(profile?.church_id);

  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');
  const [localMap, setLocalMap] = useState<Record<string, boolean>>({});
  const [downloadingMap, setDownloadingMap] = useState<Record<string, boolean>>({});
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const isAm = lang === 'am';

  const { showSkeleton } = useSkeleton({
    loading,
    hasData: resources.length > 0,
    minDisplayMs: 400,
  });

  // Check local existence of files
  const checkFiles = useCallback(async () => {
    const map: Record<string, boolean> = {};
    for (const r of resources) {
      const filename = r.file_path.split('/').pop() || 'document.pdf';
      const exists = await checkLocalResource(r.id, filename);
      map[r.id] = exists;
    }
    setLocalMap(map);
  }, [resources]);

  useEffect(() => {
    if (resources.length > 0) {
      checkFiles();
    }
  }, [resources, checkFiles]);

  const handleOpenDoc = async (item: Resource) => {
    try {
      const filename = item.file_path.split('/').pop() || 'document.pdf';
      const isLocal = localMap[item.id];

      if (!isLocal) {
        setDownloadingMap((prev) => ({ ...prev, [item.id]: true }));
        await downloadResource(item, (pct) => {
          setProgressMap((prev) => ({ ...prev, [item.id]: pct }));
        });
        setLocalMap((prev) => ({ ...prev, [item.id]: true }));
      }

      await openResource(item);
    } catch (err) {
      reportError(err, 'Resources.handleOpenDoc', lang);
    } finally {
      setDownloadingMap((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const categories: { id: CategoryFilter; labelKey: any }[] = [
    { id: 'all', labelKey: 'categoryAll' },
    { id: 'sermon_notes', labelKey: 'catSermonNotes' },
    { id: 'study_guide', labelKey: 'catStudyGuide' },
    { id: 'calendar', labelKey: 'catCalendar' },
    { id: 'announcement_doc', labelKey: 'catAnnouncementDoc' },
    { id: 'other', labelKey: 'catOther' },
  ];

  const filteredResources = resources.filter(
    (r) => selectedCategory === 'all' || r.category === selectedCategory
  );

  const formatMB = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0.1 MB';
    const mb = bytes / (1024 * 1024);
    return mb < 0.1 ? '< 0.1 MB' : `${mb.toFixed(1)} MB`;
  };

  const getCategoryLabel = (cat: ResourceCategory): string => {
    switch (cat) {
      case 'sermon_notes':
        return t(lang, 'catSermonNotes');
      case 'study_guide':
        return t(lang, 'catStudyGuide');
      case 'calendar':
        return t(lang, 'catCalendar');
      case 'announcement_doc':
        return t(lang, 'catAnnouncementDoc');
      default:
        return t(lang, 'catOther');
    }
  };

  return (
    <SafeAreaView style={[s.wrap, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Text style={[s.title, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
          {t(lang, 'resources')}
        </Text>
        {!online && (
          <View style={[s.offlineTag, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[s.offlineText, { color: colors.textFaint }]}>
              {t(lang, 'noSignal')}
            </Text>
          </View>
        )}
      </View>

      {/* Category Filter Pills */}
      <View style={s.filterWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterBar}
        >
          {categories.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(cat.id)}
                style={[
                  s.filterChip,
                  {
                    borderColor: active ? colors.accent : colors.border,
                    backgroundColor: active ? colors.accent : colors.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    s.filterChipText,
                    {
                      color: active ? colors.bg : colors.textSoft,
                      fontFamily: isAm ? fonts.amBold : undefined,
                    },
                  ]}
                >
                  {t(lang, cat.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Content Section */}
      <SectionBoundary name="Resources.List" loading={showSkeleton} skeleton={<ResourceSkeleton count={5} />} onRetry={reload}>
        <ScrollView contentContainerStyle={s.content}>
          {filteredResources.length === 0 ? (
            /* Clean Empty State: No Retry Button, Not an Error */
            <View style={[s.emptyState, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Icon name="gear" size={28} color={colors.textFaint} />
              <Text style={[s.emptyText, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}>
                {t(lang, 'noDocumentsYet')}
              </Text>
            </View>
          ) : (
            filteredResources.map((item) => {
              const title = (isAm ? item.title_am || item.title_en : item.title_en || item.title_am) || 'Untitled Document';
              const sizeStr = formatMB(item.file_size_bytes);
              const dateStr = new Date(item.created_at).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
              const isDownloaded = Boolean(localMap[item.id]);
              const isDownloading = Boolean(downloadingMap[item.id]);
              const pct = Math.round((progressMap[item.id] || 0) * 100);

              return (
                <Pressable
                  key={item.id}
                  style={[s.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => handleOpenDoc(item)}
                >
                  <View style={[s.docIconWrap, { backgroundColor: colors.bg }]}>
                    <Icon name="gear" size={20} color={colors.accent} />
                  </View>

                  <View style={s.cardInfo}>
                    <Text style={[s.docTitle, { color: colors.text, fontFamily: isAm ? fonts.amBold : undefined }]}>
                      {title}
                    </Text>

                    {item.description ? (
                      <Text
                        style={[s.docDesc, { color: colors.textSoft, fontFamily: isAm ? fonts.am : undefined }]}
                        numberOfLines={1}
                      >
                        {item.description}
                      </Text>
                    ) : null}

                    <View style={s.cardMetaRow}>
                      <View style={[s.catChip, { borderColor: colors.border, backgroundColor: colors.bg }]}>
                        <Text style={[s.catChipText, { color: colors.accent }]}>
                          {getCategoryLabel(item.category)}
                        </Text>
                      </View>
                      <Text style={[s.dateText, { color: colors.textFaint }]}>{dateStr}</Text>
                    </View>
                  </View>

                  {/* Size Pill + Download / Action Status */}
                  <View style={s.actionCol}>
                    <View style={[s.sizePill, { borderColor: colors.accent, backgroundColor: colors.bg }]}>
                      <Text style={[s.sizeText, { color: colors.accent }]}>{sizeStr}</Text>
                    </View>

                    {isDownloading ? (
                      <View style={s.progressRow}>
                        <ActivityIndicator size="small" color={colors.accent} />
                        <Text style={[s.pctText, { color: colors.accent }]}>{pct}%</Text>
                      </View>
                    ) : (
                      <View style={s.statusRow}>
                        <Icon
                          name={isDownloaded ? 'check' : 'send'}
                          size={12}
                          color={isDownloaded ? colors.success : colors.textSoft}
                        />
                        <Text
                          style={[
                            s.statusText,
                            { color: isDownloaded ? colors.success : colors.textSoft },
                          ]}
                        >
                          {isDownloaded ? (isAm ? 'ወርዷል' : 'Local') : (isAm ? 'ክፈት' : 'Open')}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </SectionBoundary>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700' },
  offlineTag: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  offlineText: { fontSize: 10, fontWeight: '600' },

  filterWrapper: {
    paddingVertical: 10,
  },
  filterBar: {
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipText: { fontSize: 12, fontWeight: '600' },

  content: {
    paddingHorizontal: space.lg,
    paddingBottom: 40,
    gap: space.sm,
  },

  emptyState: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
    marginTop: space.lg,
    gap: space.sm,
  },
  emptyText: { fontSize: 14, fontWeight: '500' },

  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    alignItems: 'center',
  },
  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: space.md,
    marginRight: space.xs,
  },
  docTitle: { fontSize: 14.5, fontWeight: '600', marginBottom: 2 },
  docDesc: { fontSize: 12, marginBottom: 4 },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  catChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  catChipText: { fontSize: 9.5, fontWeight: '700' },
  dateText: { fontSize: 11 },

  actionCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  sizePill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sizeText: { fontSize: 11, fontWeight: '700' },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pctText: { fontSize: 10, fontWeight: '700' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: { fontSize: 10.5, fontWeight: '600' },
});
