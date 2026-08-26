import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useApp } from '@/theme/context';
import { t } from '@/i18n';
import { useAuth } from '../lib/auth';

export default function AppTabs() {
  const { c: colors, lang } = useApp();
  const { isPastor } = useAuth();

  return (
    <NativeTabs
      backgroundColor={colors.bg}
      indicatorColor={colors.accent}
      labelStyle={{ selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t(lang, "today")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/today.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="bible">
        <NativeTabs.Trigger.Label>{t(lang, "bible")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/bible.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="resources">
        <NativeTabs.Trigger.Label>{t(lang, "resources")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/resources.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>{t(lang, "more")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/more.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {isPastor && (
        <NativeTabs.Trigger name="admin">
          <NativeTabs.Trigger.Label>{t(lang, "admin")}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            src={require('@/assets/images/tabIcons/admin.png')}
            renderingMode="template"
          />
        </NativeTabs.Trigger>
      )}
    </NativeTabs>
  );
}
