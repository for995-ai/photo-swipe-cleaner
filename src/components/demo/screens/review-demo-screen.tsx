/**
 * Section 03 的手機畫面：模擬待刪確認頁與全螢幕預覽。
 *
 * 沿用正式 review.tsx 的視覺語言（3 欄網格、2px 描邊內縮、待刪計數），
 * 但不 import 它，也不使用 useDiscardedResolver：Demo 的清單就是 fixture 陣列。
 * 「保留這張」只改 Demo local state，不會呼叫任何 Session API。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DemoPhotoArt } from '@/components/demo/demo-photo-art';
import { CheckIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import type { DemoPhoto } from '@/lib/demo-fixtures';
import { border, colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

/** 與正式 Review 相同的欄數。 */
const COLUMNS = 3;

type Props = {
  screenWidth: number;
  items: readonly DemoPhoto[];
  /** 目前打開預覽的索引；null 代表關閉。 */
  previewIndex: number | null;
  onOpenPreview: (index: number) => void;
  onClosePreview: () => void;
  onKeepPhoto: (id: string) => void;
};

export function ReviewDemoScreen({
  screenWidth,
  items,
  previewIndex,
  onOpenPreview,
  onClosePreview,
  onKeepPhoto,
}: Props) {
  const pad = Math.round(screenWidth * 0.055);
  const gap = spacing.sm;
  const cellSize = Math.floor((screenWidth - pad * 2 - gap * (COLUMNS - 1)) / COLUMNS);
  const cellInner = cellSize - border.width * 2;

  const preview = previewIndex !== null ? items[previewIndex] : undefined;

  // 全螢幕預覽：直接覆蓋整個螢幕區域，不用 Modal
  // （Modal 在 web 會建立額外的 portal，這裡只要蓋住手機內部即可）。
  if (preview) {
    const previewSize = screenWidth - pad * 2;
    return (
      <View style={[styles.previewRoot, { padding: pad, gap: spacing.ms }]}>
        <View style={styles.previewHeader}>
          <Text
            style={[typeStyle(typeAccent.buttonSmall, screenWidth), styles.previewTitle]}
            numberOfLines={1}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            {preview.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="關閉預覽"
            hitSlop={12}
            onPress={onClosePreview}
            style={styles.closeHit}>
            <Text
              style={[typeStyle(typeAccent.button, screenWidth), styles.close]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              關閉
            </Text>
          </Pressable>
        </View>

        <View style={styles.previewBody}>
          <PixelSurface clip style={styles.previewSurface}>
            <DemoPhotoArt photo={preview} size={previewSize} />
          </PixelSurface>
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            {`${preview.category}・${preview.createdAt}`}
          </Text>
        </View>

        <PixelButton
          label="保留這張"
          tone="keep"
          haptics={false}
          icon={<CheckIcon size={iconSize.sm} fill={colors.keepText} />}
          onPress={() => onKeepPhoto(preview.id)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <Text
        style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        待刪除確認
      </Text>

      <View style={styles.stats}>
        <PixelBadge label="待刪除" value={items.length} tone="discard" />
        <PixelBadge label="可檢視" value={items.length} tone="info" />
      </View>

      <Text
        style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        點縮圖可放大檢視
      </Text>

      {/* 用 flexWrap 排 3 欄，不用 FlatList：Demo 清單很短，也避免虛擬化在 web 的量測問題。 */}
      <View style={[styles.grid, { gap }]}>
        {items.map((photo, index) => (
          <Pressable
            key={photo.id}
            accessibilityRole="button"
            accessibilityLabel={`待刪除照片 ${index + 1}：${photo.title}，點一下放大`}
            onPress={() => onOpenPreview(index)}>
            <PixelSurface clip shadowOffset={0} style={styles.cell}>
              <DemoPhotoArt photo={photo} size={cellInner} />
            </PixelSurface>
          </Pressable>
        ))}
      </View>

      {items.length === 0 ? (
        <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.empty}>
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            待刪清單已清空
          </Text>
        </PixelSurface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  heading: {
    color: colors.textPrimary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  muted: {
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    padding: 0,
  },
  empty: {
    alignItems: 'center',
    padding: spacing.md,
  },
  previewRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewTitle: {
    color: colors.textPrimary,
    flex: 1,
  },
  closeHit: {
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  close: {
    color: colors.primaryText,
    textAlign: 'right',
  },
  previewBody: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  previewSurface: {
    padding: 0,
  },
});
