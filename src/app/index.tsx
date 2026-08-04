import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Text style={[styles.appName, { fontSize: scaleFont(15, width) }]}>相簿滑滑整理</Text>
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

      <View style={styles.footer}>
        <View style={styles.privacy}>
          <Caption>照片只在你的裝置上處理，不會上傳</Caption>
        </View>
        <AppButton label="開始整理" onPress={() => router.push('/permission')} />
        <Caption>目前為安全測試模式，尚未實作滑動與刪除功能。</Caption>
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
  appName: {
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
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
