import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppButton, Body, Caption, Notice, Screen, Title } from '@/components/ui';
import { APP_BUILD_LABEL } from '@/lib/app-info';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

const CHECKLIST = [
  'iPhone 型號（例如 iPhone 13 mini）',
  'iOS 版本（設定 → 一般 → 關於本機）',
  '你按了哪些步驟，問題在第幾步發生',
  '畫面截圖，有錯誤訊息請一起拍到',
  '當時的保留／待刪除／已刪除數字',
];

export default function FeedbackScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Title>回報問題</Title>
        <Body muted>遇到怪怪的狀況，請把下面這些資訊一起傳給開發者，會比較快找到原因。</Body>
      </View>

      <View style={styles.card}>
        {CHECKLIST.map((item, index) => (
          <View key={item} style={styles.row}>
            <Text style={[styles.index, { fontSize: scaleFont(13, width) }]}>{index + 1}</Text>
            <Text style={[styles.itemText, { fontSize: scaleFont(14, width) }]}>{item}</Text>
          </View>
        ))}
      </View>

      <Notice title="這個 App 不會自己收集資料">
        沒有分析或追蹤 SDK，不會自動蒐集裝置資訊，也沒有帳號、雲端同步或照片上傳。上面的資訊需要你自己提供，App 不會替你送出任何東西。
      </Notice>

      <View style={styles.footer}>
        <Caption>{`回報時請一併附上版本：${APP_BUILD_LABEL}`}</Caption>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  index: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    color: colors.accent,
    fontWeight: '700',
    height: 20,
    lineHeight: 20,
    textAlign: 'center',
    width: 20,
  },
  itemText: {
    color: colors.text,
    flex: 1,
    lineHeight: 21,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
