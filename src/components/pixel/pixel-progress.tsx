/**
 * 像素風進度條：12px 高、2px 描邊、分段格線。
 *
 * 比例計算與原本的 ProgressBar 完全相同（value / total 後 clamp 到 0~1），
 * 分段只是視覺：實心填充仍是精確比例，上面疊 9 條 2px 格線做出像素感，
 * 所以不會因為取整而讓進度顯示失真。
 */
import { StyleSheet, View } from 'react-native';

import { border, colors, pixel, radius } from '@/lib/theme';

export function PixelProgress({
  value,
  total,
  /** 給輔助工具朗讀的說明，例如「已處理 74 / 約 11043 張」。 */
  accessibilityLabel,
}: {
  value: number;
  total: number;
  accessibilityLabel?: string;
}) {
  // 與原實作一致，不改計算邏輯。
  const ratio = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const dividers = Math.max(pixel.barSegments - 1, 0);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: Math.max(total, 0), now: Math.min(value, total) }}
      style={styles.track}>
      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />

      {/* 格線：等分覆蓋在填充之上，做出分段像素感。 */}
      <View pointerEvents="none" style={styles.dividerRow}>
        {Array.from({ length: dividers }, (_, index) => (
          <View key={index} style={styles.dividerCell}>
            <View style={styles.divider} />
          </View>
        ))}
        <View style={styles.dividerCell} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.outline,
    borderRadius: radius.sm,
    borderWidth: border.width,
    height: pixel.barHeight,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.primary,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  dividerRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  dividerCell: {
    alignItems: 'flex-end',
    flex: 1,
  },
  divider: {
    backgroundColor: colors.outline,
    height: '100%',
    opacity: 0.35,
    width: pixel.unit,
  },
});
