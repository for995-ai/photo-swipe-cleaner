import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { useOnboarding } from '@/hooks/use-onboarding';
import { APP_BUILD_LABEL, APP_NAME, APP_VERSION_LABEL } from '@/lib/app-info';
import { MAX_TEST_DELETE_COUNT } from '@/lib/delete-service';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const onboarding = useOnboarding();

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
          <Text style={[styles.appName, { fontSize: scaleFont(15, width) }]}>{APP_NAME}</Text>
          <View style={styles.betaTag}>
            <Text style={[styles.betaTagText, { fontSize: scaleFont(11, width) }]}>
              {APP_VERSION_LABEL}
            </Text>
          </View>
        </View>
        {/* 明確在逗號後斷行，避免最後一個「憶」被擠成單獨一行。 */}
        <Title>{'用滑動，\n整理你的每一段回憶'}</Title>
        <Body muted>往左加入待刪除，往右保留；真正刪除前仍可再次確認</Body>
      </View>

      <View style={styles.hints}>
        <View style={styles.hintRow}>
          <View style={[styles.hintDot, { backgroundColor: colors.discard }]} />
          <Body muted>往左：加入待刪除清單</Body>
        </View>
        <View style={styles.hintRow}>
          <View style={[styles.hintDot, { backgroundColor: colors.keep }]} />
          <Body muted>往右：保留這張照片</Body>
        </View>
      </View>

      <View style={styles.betaNotice}>
        <Text style={[styles.betaTitle, { fontSize: scaleFont(13, width) }]}>
          {APP_BUILD_LABEL}
        </Text>
        <Caption>請先使用不重要的照片測試</Caption>
        <Caption>{`每次最多刪除 ${MAX_TEST_DELETE_COUNT} 張`}</Caption>
      </View>

      <View style={styles.footer}>
        <View style={styles.privacy}>
          <Caption>照片只在你的裝置上處理，不會上傳</Caption>
        </View>
        <AppButton label="開始整理" onPress={() => router.push('/permission')} />
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
          <AppButton
            label="重新顯示使用教學"
            variant="ghost"
            onPress={confirmResetOnboarding}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.lg,
    justifyContent: 'space-between',
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  appName: {
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
  },
  betaTag: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  betaTagText: {
    color: colors.warning,
    fontWeight: '700',
  },
  betaNotice: {
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.md,
  },
  betaTitle: {
    color: colors.warning,
    fontWeight: '700',
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkSlot: {
    flex: 1,
  },
  hints: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  hintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  hintDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  footer: {
    gap: spacing.md,
  },
  privacy: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
});
