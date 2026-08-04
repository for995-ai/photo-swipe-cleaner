import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, TrashIcon } from '@/components/icons';
import { AppButton, Body, Caption } from '@/components/ui';
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

/** 首次使用教學。只在尚未完成教學時由 photos 頁掛起。 */
export function OnboardingModal({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              paddingLeft: Math.max(insets.left, spacing.lg),
              paddingRight: Math.max(insets.right, spacing.lg),
            },
          ]}>
          <View style={styles.content}>
            <Text style={[styles.title, { fontSize: scaleFont(22, width) }]}>怎麼使用</Text>

            <View style={styles.row}>
              <TrashIcon size={22} color={colors.discard} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.discard, fontSize: scaleFont(15, width) }]}>
                  左滑：加入待刪除
                </Text>
                <Caption>照片只會被標記，不會馬上消失。</Caption>
              </View>
            </View>

            <View style={styles.row}>
              <CheckIcon size={22} color={colors.keep} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.keep, fontSize: scaleFont(15, width) }]}>
                  右滑：保留
                </Text>
                <Caption>保留的照片不會被刪除。</Caption>
              </View>
            </View>

            <View style={styles.notes}>
              <Body muted>• 滑動不會立即刪除照片</Body>
              <Body muted>• 必須到確認頁再次檢查待刪除清單</Body>
              <Body muted>• iPhone 系統會進行最後確認</Body>
            </View>
          </View>

          <AppButton label="我知道了" onPress={onDone} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sheet: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'space-between',
  },
  content: {
    gap: spacing.md,
  },
  title: {
    color: colors.text,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTitle: {
    fontWeight: '700',
  },
  notes: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.md,
  },
});
