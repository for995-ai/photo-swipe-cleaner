import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ShieldIcon } from '@/components/icons';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { APP_BUILD_LABEL } from '@/lib/app-info';
import { colors, iconSize, radius, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

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

      <View style={styles.list}>
        {CHECKLIST.map((item, index) => (
          <PixelSurface key={item} style={styles.card}>
            {/* 像素方形編號：小圓角 + 2px 描邊，不用圓形。 */}
            <PixelSurface
              background={colors.surfaceAlt}
              cornerRadius={radius.sm}
              shadowOffset={0}
              style={styles.index}>
              <Text
                style={[typeStyle(typeAccent.badgeValue, width), styles.indexText]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {index + 1}
              </Text>
            </PixelSurface>
            <View style={styles.cardText}>
              <Body>{item}</Body>
            </View>
          </PixelSurface>
        ))}
      </View>

      <PixelNotice
        title="這個 App 不會自己收集資料"
        icon={<ShieldIcon size={iconSize.sm} fill={colors.keep} />}>
        沒有分析或追蹤 SDK，不會自動蒐集裝置資訊，也沒有帳號、雲端同步或照片上傳。上面的資訊需要你自己提供，App 不會替你送出任何東西。
      </PixelNotice>

      <View style={styles.footer}>
        <Caption>{`回報時請一併附上版本：${APP_BUILD_LABEL}`}</Caption>
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
  list: {
    gap: spacing.sm,
  },
  card: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  index: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
    minWidth: 26,
  },
  indexText: {
    color: colors.primaryText,
  },
  cardText: {
    flex: 1,
  },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
