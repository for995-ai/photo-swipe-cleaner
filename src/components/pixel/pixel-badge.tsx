/**
 * 像素風標籤：2px 描邊 + 2px 短陰影的小方角膠囊（刻意不做全圓角）。
 *
 * 狀態除了顏色，還用「方塊記號 + 文字標籤」雙重編碼，
 * 不依賴顏色本身傳達語意。
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PixelSurface } from '@/components/pixel/pixel-surface';
import { colors, pixel, radius, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export type PixelBadgeTone = 'keep' | 'discard' | 'info' | 'warning' | 'neutral';

const TONE_COLOR: Record<PixelBadgeTone, string> = {
  keep: colors.keep,
  discard: colors.discard,
  info: colors.primary,
  warning: colors.warning,
  neutral: colors.outline,
};

export function PixelBadge({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label?: string;
  /** 有值就顯示在標籤右側；沒有就只顯示文字。 */
  value?: number | string;
  tone?: PixelBadgeTone;
  icon?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const accent = TONE_COLOR[tone];

  return (
    <PixelSurface
      background={colors.surface}
      cornerRadius={radius.sm}
      shadowOffset={pixel.unit}
      style={styles.badge}>
      {icon ? (
        <View style={styles.icon}>{icon}</View>
      ) : (
        // 方形記號（非圓點），像素感也讓形狀本身帶資訊。
        <View style={[styles.mark, { backgroundColor: accent }]} />
      )}
      {label ? (
        <Text
          style={[typeStyle(typeAccent.badgeLabel, width), styles.label]}
          // 標籤文字在最大字級下可以折成兩行（例如「安全刪除模式」），不截斷。
          numberOfLines={2}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {label}
        </Text>
      ) : null}
      {value !== undefined ? (
        <Text
          style={[typeStyle(typeAccent.badgeValue, width), styles.value]}
          numberOfLines={1}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {value}
        </Text>
      ) : null}
    </PixelSurface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    borderColor: colors.outline,
    borderWidth: 1,
    height: pixel.unit * 4,
    width: pixel.unit * 4,
  },
  label: {
    color: colors.textSecondary,
  },
  value: {
    color: colors.textPrimary,
  },
});
