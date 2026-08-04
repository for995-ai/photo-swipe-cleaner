/**
 * 像素風提示卡：2px 描邊 + 硬陰影 + 左側 8px 實色色塊。
 *
 * 色塊只是輔助，狀態一律同時有文字標題（必要時再加圖示），
 * 不會只靠顏色區分。圖示 slot 留給後續階段接上像素圖示。
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PixelSurface } from '@/components/pixel/pixel-surface';
import { colors, pixel, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export type PixelNoticeTone = 'info' | 'warning' | 'danger' | 'success';

/** 左側色塊是填色，所以用粉彩本色（不是當文字用，對比不成問題）。 */
const TONE_COLOR: Record<PixelNoticeTone, string> = {
  info: colors.primary,
  warning: colors.warning,
  danger: colors.discard,
  success: colors.keep,
};

export function PixelNotice({
  tone = 'info',
  title,
  icon,
  compact = false,
  children,
}: {
  tone?: PixelNoticeTone;
  title?: string;
  icon?: ReactNode;
  /** 單行提示用：收斂內距，省下垂直空間（例如整理頁底部的安全說明）。 */
  compact?: boolean;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const accent = TONE_COLOR[tone];

  return (
    <PixelSurface style={styles.card} clip>
      {/* 左側色塊：4 個像素單位寬的實色條。 */}
      <View style={[styles.stripe, { backgroundColor: accent }]} />
      <View style={[styles.body, compact && styles.bodyCompact]}>
        {title ? (
          <View style={styles.titleRow}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              style={[typeStyle(typeAccent.noticeTitle, width), styles.title]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {title}
            </Text>
          </View>
        ) : null}
        <Text
          style={[typeStyle(typeAccent.noticeBody, width), styles.text]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {children}
        </Text>
      </View>
    </PixelSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
  },
  stripe: {
    width: pixel.unit * 4,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.ms,
  },
  bodyCompact: {
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
  },
  text: {
    color: colors.textSecondary,
  },
});
