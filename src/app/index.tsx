import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CheckIcon, ShieldIcon, TrashIcon, WarnIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { useOnboarding } from '@/hooks/use-onboarding';
import { APP_BUILD_LABEL, APP_NAME, APP_VERSION_LABEL } from '@/lib/app-info';
import { MAX_DELETE_COUNT_PER_BATCH } from '@/lib/delete-service';
import { getPhotoAccessAsync } from '@/lib/photos';
import { colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const onboarding = useOnboarding();
  const [checking, setChecking] = useState(false);

  /**
   * 只「查詢」既有權限來決定下一頁，不會請求權限，
   * 所以按下這顆按鈕不會跳出系統權限視窗。
   */
  const handleStart = async () => {
    if (checking) {
      return;
    }
    setChecking(true);
    try {
      const access = await getPhotoAccessAsync();
      const readable = access.level === 'full' || access.level === 'limited';
      router.push(readable ? '/scope' : '/permission');
    } catch {
      // 查不到狀態就走權限頁，由使用者自己按「允許存取」。
      router.push('/permission');
    } finally {
      setChecking(false);
    }
  };

  const confirmResetOnboarding = () => {
    Alert.alert(
      '重新顯示使用教學？',
      '只會清除「已看過教學」這個標記，整理進度與統計不會有任何變動。下次進入整理頁時會再顯示一次教學。',
      [
        { text: '取消', style: 'cancel' },
        { text: '重新顯示', onPress: () => onboarding.reset() },
      ]
    );
  };

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          {/* App 名稱降為次級標示，主標題才是視覺重心。 */}
          <Text
            style={[typeStyle(typeAccent.badgeLabel, width), styles.appName]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            {APP_NAME}
          </Text>
          <PixelBadge label={APP_VERSION_LABEL} tone="warning" />
        </View>
        {/* 明確在逗號後斷行，避免最後一個「憶」被擠成單獨一行。 */}
        <Title>{'用滑動，\n整理你的每一段回憶'}</Title>
        <Body muted>往左加入待刪除，往右保留；真正刪除前仍可再次確認</Body>
      </View>

      <PixelSurface style={styles.hints}>
        <View style={styles.hintRow}>
          <TrashIcon size={iconSize.md} fill={colors.discard} />
          <Body muted>往左：加入待刪除清單</Body>
        </View>
        <View style={styles.hintRow}>
          <CheckIcon size={iconSize.md} fill={colors.keep} />
          <Body muted>往右：保留這張照片</Body>
        </View>
      </PixelSurface>

      <PixelNotice
        tone="warning"
        title={APP_BUILD_LABEL}
        icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
        {`請先使用不重要的照片測試。每次最多刪除 ${MAX_DELETE_COUNT_PER_BATCH} 張。`}
      </PixelNotice>

      <View style={styles.footer}>
        <PixelSurface background={colors.surfaceAlt} style={styles.privacy}>
          <ShieldIcon size={iconSize.md} fill={colors.keep} />
          <View style={styles.privacyText}>
            <Caption>照片只在你的裝置上處理，不會上傳</Caption>
          </View>
        </PixelSurface>

        {/* 唯一的主要 CTA。 */}
        <AppButton
          label={checking ? '正在確認權限…' : '開始整理'}
          disabled={checking}
          onPress={() => void handleStart()}
        />

        <View style={styles.linkRow}>
          <View style={styles.linkSlot}>
            <AppButton label="關於與隱私" variant="ghost" onPress={() => router.push('/about')} />
          </View>
          <View style={styles.linkSlot}>
            <AppButton label="回報問題" variant="ghost" onPress={() => router.push('/feedback')} />
          </View>
        </View>

        {/*
          僅開發期入口。__DEV__ 在 production 會被替換成 false，
          整個三元運算式會被摺疊成 null，正式版不會有這顆按鈕。
        */}
        {__DEV__ ? (
          <AppButton label="重新顯示使用教學" variant="ghost" onPress={confirmResetOnboarding} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  appName: {
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  hints: {
    gap: spacing.ms,
    padding: spacing.md,
  },
  hintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
  },
  footer: {
    gap: spacing.ms,
  },
  privacy: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  privacyText: {
    flex: 1,
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkSlot: {
    flex: 1,
  },
});
