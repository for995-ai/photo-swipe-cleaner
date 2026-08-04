import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { APP_BUILD_LABEL, APP_NAME } from '@/lib/app-info';
import { MAX_TEST_DELETE_COUNT } from '@/lib/delete-service';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

const POINTS: { title: string; detail: string }[] = [
  {
    title: '照片不會上傳到開發者伺服器',
    detail: `${APP_NAME} 沒有任何上傳或連線功能，所有處理都在你的 iPhone 上完成。`,
  },
  {
    title: '照片由 iPhone 相簿權限管理',
    detail: '能讀取哪些照片完全由你在 iOS 設定裡的相簿權限決定，可隨時改成有限存取或關閉。',
  },
  {
    title: '滑動只會標記',
    detail: '左滑加入待刪除、右滑保留，都只是在本機做記號，照片本身不會有任何變動。',
  },
  {
    title: '真正刪除需要確認頁與 iPhone 系統確認',
    detail: `要先在確認頁檢查待刪除清單，按下刪除後 iPhone 還會再要求一次確認。每次最多 ${MAX_TEST_DELETE_COUNT} 張。`,
  },
  {
    title: '已刪除照片可前往「最近刪除」查看',
    detail: '刪除的照片會移到 iPhone「照片」App 的「最近刪除」，通常可在 30 天內復原。',
  },
  {
    title: '使用 Expo Go 測試時，系統視窗會顯示 Expo Go 名稱',
    detail: '這是 Expo Go 的限制：權限與刪除的系統視窗讀的是 Expo Go 的資訊，不代表操作對象有誤。',
  },
];

export default function AboutScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Title>關於與隱私</Title>
        <Caption>{`${APP_NAME}．${APP_BUILD_LABEL}`}</Caption>
      </View>

      <View style={styles.list}>
        {POINTS.map((point) => (
          <View key={point.title} style={styles.card}>
            <Text style={[styles.cardTitle, { fontSize: scaleFont(15, width) }]}>
              {point.title}
            </Text>
            <Caption>{point.detail}</Caption>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.versionBox}>
          <Body muted>{`版本：${APP_BUILD_LABEL}`}</Body>
        </View>
        <AppButton label="返回" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontWeight: '700',
    lineHeight: 22,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  versionBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
});
