import { Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrowIcon, CheckIcon, TrashIcon } from '@/components/icons';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { Caption } from '@/components/ui';
import { colors, iconSize, pixel, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeScale, typeStyle } from '@/lib/typography';

/** 三項安全提醒。每一項前面都有 2px 方塊 bullet。 */
const NOTES = [
  '左滑不會立刻刪除照片，只是先加入待刪除清單。',
  '按「復原」可以取消剛才的決定。',
  '最後仍要在確認頁檢查，並通過 iPhone 系統確認才會真正刪除。',
];

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
      {/* accessibilityViewIsModal：VoiceOver 焦點鎖在教學內，不會滑到底下的整理頁。 */}
      <View accessibilityViewIsModal style={styles.backdrop}>
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
          {/*
            iPhone SE（667pt）配上最大字級時，標題 + 兩張說明卡 + 三項提醒
            會超過畫面高度，原本的 space-between 版面會把「我知道了」推出畫面外。
            改成內容可捲動、按鈕固定在捲動區外面：安全提醒一項都沒有縮小，
            按鈕也永遠到得了。
          */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            alwaysBounceVertical={false}
            showsVerticalScrollIndicator={false}>
            <Text
              style={[typeStyle(typeScale.title, width), styles.title]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              怎麼使用
            </Text>

            {/* 左滑：方向箭頭 + 圖示 + 文字，不只靠紅色辨識。 */}
            <PixelSurface style={styles.row}>
              <ArrowIcon direction="left" size={iconSize.md} fill={colors.discard} />
              <TrashIcon size={iconSize.lg} fill={colors.discard} />
              <View style={styles.rowText}>
                <Text
                  style={[typeStyle(typeAccent.button, width), styles.rowTitleDiscard]}
                  maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                  左滑：加入待刪除
                </Text>
                <Caption>照片只會被標記，不會馬上消失。</Caption>
              </View>
            </PixelSurface>

            {/* 右滑：方向箭頭在右側，和左滑形成對稱。 */}
            <PixelSurface style={styles.row}>
              <CheckIcon size={iconSize.lg} fill={colors.keep} />
              <View style={styles.rowText}>
                <Text
                  style={[typeStyle(typeAccent.button, width), styles.rowTitleKeep]}
                  maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                  右滑：保留
                </Text>
                <Caption>保留的照片不會被刪除。</Caption>
              </View>
              <ArrowIcon direction="right" size={iconSize.md} fill={colors.keep} />
            </PixelSurface>

            <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.notes}>
              {NOTES.map((note) => (
                <View key={note} style={styles.noteRow}>
                  <View style={styles.bullet} />
                  <View style={styles.noteText}>
                    <Caption>{note}</Caption>
                  </View>
                </View>
              ))}
            </PixelSurface>
          </ScrollView>

          <PixelButton label="我知道了" accessibilityLabel="我知道了，關閉使用教學" onPress={onDone} />
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
  },
  /** 捲動區吃掉剩下的高度，按鈕永遠留在它下面。 */
  scroll: {
    flex: 1,
  },
  content: {
    // 字級小時內容仍然靠上排，不要因為 flexGrow 而在中間留下大片空白。
    flexGrow: 1,
    gap: spacing.ms,
  },
  title: {
    color: colors.textPrimary,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.ms,
    padding: spacing.ms,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTitleDiscard: {
    color: colors.discardText,
  },
  rowTitleKeep: {
    color: colors.keepText,
  },
  notes: {
    gap: spacing.sm,
    padding: spacing.ms,
  },
  noteRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  /** 2px 格點的方塊 bullet，取代圓點。 */
  bullet: {
    backgroundColor: colors.primary,
    borderColor: colors.outline,
    borderWidth: 1,
    height: pixel.unit * 3,
    marginTop: pixel.unit * 3,
    width: pixel.unit * 3,
  },
  noteText: {
    flex: 1,
  },
});
