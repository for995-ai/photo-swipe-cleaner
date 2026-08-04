import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CheckIcon, PhotoIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { AppButton, Caption, Screen, Title } from '@/components/ui';
import { APP_BUILD_LABEL, APP_NAME, APP_VERSION_LABEL } from '@/lib/app-info';
import { MAX_DELETE_COUNT_PER_BATCH } from '@/lib/delete-service';
import { colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

type Point = { title: string; detail: string; icon: ReactNode };

const POINTS: Point[] = [
  {
    title: '照片不會上傳到開發者伺服器',
    detail: `${APP_NAME} 沒有任何上傳或連線功能，所有處理都在你的 iPhone 上完成。`,
    icon: <ShieldIcon size={iconSize.md} fill={colors.keep} />,
  },
  {
    title: '沒有分析或追蹤',
    detail: '沒有安裝任何分析、追蹤或崩潰回報 SDK，也不會自動收集裝置資訊或使用行為。',
    icon: <ShieldIcon size={iconSize.md} fill={colors.primary} />,
  },
  {
    title: '照片由 iPhone 相簿權限管理',
    detail: '能讀取哪些照片完全由你在 iOS 設定裡的相簿權限決定，可隨時改成有限存取或關閉。',
    icon: <PhotoIcon size={iconSize.md} fill={colors.primary} />,
  },
  {
    title: '滑動只會標記',
    detail: '左滑只是把照片加入待刪除清單、右滑保留，都只是在本機做記號，照片本身不會有任何變動。',
    icon: <TrashIcon size={iconSize.md} fill={colors.discard} />,
  },
  {
    title: '真正刪除需要確認頁與 iPhone 系統確認',
    detail: `要先在確認頁檢查待刪除清單，按下刪除後 iPhone 還會再要求一次確認。每次最多 ${MAX_DELETE_COUNT_PER_BATCH} 張。`,
    icon: <CheckIcon size={iconSize.md} fill={colors.keep} />,
  },
  {
    title: '已刪除照片可前往「最近刪除」查看',
    detail: '刪除的照片會移到 iPhone「照片」App 的「最近刪除」，通常可在 30 天內復原。',
    icon: <TrashIcon size={iconSize.md} fill={colors.warning} />,
  },
  {
    title: '使用 Expo Go 測試時，系統視窗會顯示 Expo Go 名稱',
    detail: '這是 Expo Go 的限制：權限與刪除的系統視窗讀的是 Expo Go 的資訊，不代表操作對象有誤。',
    icon: <PhotoIcon size={iconSize.md} fill={colors.warning} />,
  },
];

export default function AboutScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Title>關於與隱私</Title>
        <View style={styles.badgeRow}>
          <Caption>{APP_NAME}</Caption>
          <PixelBadge label={APP_VERSION_LABEL} tone="warning" />
        </View>
      </View>

      <View style={styles.list}>
        {POINTS.map((point) => (
          <PixelSurface key={point.title} style={styles.card}>
            <View style={styles.cardIcon}>{point.icon}</View>
            <View style={styles.cardText}>
              <Text
                style={[typeStyle(typeAccent.button, width), styles.cardTitle]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {point.title}
              </Text>
              <Caption>{point.detail}</Caption>
            </View>
          </PixelSurface>
        ))}
      </View>

      <View style={styles.footer}>
        <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.versionBox}>
          <Caption>版本</Caption>
          <PixelBadge label={APP_BUILD_LABEL} tone="info" />
        </PixelSurface>
        <AppButton label="返回" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.ms,
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  cardIcon: {
    paddingTop: 2,
  },
  cardText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitle: {
    color: colors.textPrimary,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  versionBox: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.ms,
  },
});
