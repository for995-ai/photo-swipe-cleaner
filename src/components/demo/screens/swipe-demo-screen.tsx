/**
 * Section 01 的手機畫面：模擬滑動整理頁。
 *
 * 只模仿正式 photos.tsx / SwipeCard 的 UI language，不 import 它們：
 * 正式卡片綁在 RecentPhoto 與 expo-image 上，Demo 沒有真實照片 uri。
 *
 * 決策回饋（勾勾／叉叉）刻意對齊正式 SwipeCard 的三層結構：
 *   1. 方向側加粗描邊（右滑強調右邊、左滑強調左邊）
 *   2. 疊在照片中央的徽章：圖示 + 文字，深色 scrim + 奶油白描邊
 *   3. 卡片本體 ±8deg 傾斜 + 位移退場（約 190~200ms）
 * 數值與正式版相同，只有徽章位置依 Demo 需求略微偏向一側。
 *
 * 所有狀態都由呼叫端以 React state 持有，這裡是純受控元件。
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { DemoPhotoArt } from '@/components/demo/demo-photo-art';
import { CheckIcon, TrashIcon, UndoIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelProgress } from '@/components/pixel/pixel-progress';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import type { DemoPhoto } from '@/lib/demo-fixtures';
import { border, colors, pixel, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

/** 與正式 SwipeCard 相同量級的退場時間（正式版 EXIT_DURATION = 190）。 */
const EXIT_DURATION = 200;
/** 徽章浮現要比卡片退場更快，才會「和卡片一起動」而不是事後才出現。 */
const MARK_IN_DURATION = 120;
/** reduced motion：只用短暫 opacity 顯示，讓使用者仍看得到判定結果。 */
const REDUCED_HOLD_DURATION = 280;
/** 徽章圖示大小。48 = 12 格 × 4px，剛好落在像素圖示的 2px 格點上。 */
const MARK_ICON_SIZE = 48;

export type SwipeDemoDecision = 'keep' | 'discard';

type Props = {
  screenWidth: number;
  photo: DemoPhoto | null;
  kept: number;
  discarded: number;
  processed: number;
  total: number;
  /** 上一次的決定，用來播放退場方向與決策徽章；null 代表沒有動畫。 */
  exiting: SwipeDemoDecision | null;
  onExitDone: () => void;
  reducedMotion: boolean;
};

/* ------------------------------------------------------------------ 像素 ✕ */

/**
 * 像素叉叉。
 *
 * 正式 icons.tsx 沒有 ✕ 這個字形，而它的 PixelIcon 沒有對外匯出，
 * 所以這裡用**完全相同的做法**在 Demo 內畫一個：12×12 點陣圖展開成 View 方塊，
 * '#' 是外框色、'o' 是粉彩填色、'.' 透明，格子邊長一律取 2px 的整數倍。
 *
 * 沒有圖片、SVG、Emoji 或 Unicode 字元。
 */
const X_BITMAP: readonly string[] = [
  '##........##',
  '#o#......#o#',
  '.#o#....#o#.',
  '..#o#..#o#..',
  '...#o##o#...',
  '....#oo#....',
  '....#oo#....',
  '...#o##o#...',
  '..#o#..#o#..',
  '.#o#....#o#.',
  '#o#......#o#',
  '##........##',
];

function PixelXMark({ size, fill }: { size: number; fill: string }) {
  const grid = X_BITMAP.length;
  // 與 icons.tsx 的 resolveRender 同一套規則：格子邊長貼齊 2px 格點。
  const cell = Math.max(pixel.unit, Math.floor(size / grid / pixel.unit) * pixel.unit);

  return (
    // 純裝飾：語意由徽章上的文字負責，避免 VoiceOver 重複朗讀。
    <View accessible={false} style={{ width: cell * grid, height: cell * grid }}>
      {X_BITMAP.map((row, y) =>
        row.split('').map((token, x) => {
          if (token === '.') {
            return null;
          }
          return (
            <View
              key={`${x}-${y}`}
              style={{
                position: 'absolute',
                left: x * cell,
                top: y * cell,
                width: cell,
                height: cell,
                backgroundColor: token === '#' ? colors.outline : fill,
              }}
            />
          );
        })
      )}
    </View>
  );
}

/* ------------------------------------------------- 決策徽章（疊在照片上） */

/**
 * 疊在照片上的判定回饋。
 *
 * 結構完全照正式 SwipeCard：方向側加粗的描邊框 + 中央徽章（雙層 scrim
 * 讓奶油白文字在任何照片上都讀得到）。差別只有兩點：
 * - 徽章用 PixelSurface，因此多了 App 的硬陰影語言
 * - 依本輪需求，保留徽章偏左、待刪徽章偏右（正式版是置中）
 */
function DecisionOverlay({
  decision,
  screenWidth,
  progress,
  reducedMotion,
}: {
  decision: SwipeDemoDecision;
  screenWidth: number;
  progress: Animated.Value;
  reducedMotion: boolean;
}) {
  const keep = decision === 'keep';

  // reduced motion 不做放大，只用 opacity。
  const scale = reducedMotion
    ? 1
    : progress.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });

  return (
    <View style={styles.overlayRoot}>
      {/* 方向側加粗描邊：與正式版的 tintKeep / tintDiscard 同一組數值。 */}
      <Animated.View
        style={[
          styles.tint,
          keep ? styles.tintKeep : styles.tintDiscard,
          { opacity: progress },
        ]}
      />

      <Animated.View
        style={[
          styles.badgeSlot,
          // 右滑（保留）徽章偏左、左滑（待刪）徽章偏右：
          // 卡片往外飛時，徽章留在畫面內的時間比較長。
          keep ? styles.badgeSlotKeep : styles.badgeSlotDiscard,
          { opacity: progress, transform: [{ scale }] },
        ]}>
        <PixelSurface
          clip
          background={colors.overlayScrim}
          outlineColor={colors.surface}
          outlineWidth={border.width}
          cornerRadius={radius.md}
          shadowOffset={shadow.offset}
          style={styles.badge}>
          {/* 第二層 scrim：與正式版相同手法，疊出足夠不透明度。 */}
          <View style={styles.badgeScrim} />
          {keep ? (
            <CheckIcon size={MARK_ICON_SIZE} fill={colors.keep} />
          ) : (
            <PixelXMark size={MARK_ICON_SIZE} fill={colors.discard} />
          )}
          <Text
            style={[
              typeStyle(typeAccent.button, screenWidth),
              styles.badgeText,
            ]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            {keep ? '保留' : '待刪除'}
          </Text>
        </PixelSurface>
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------------------ 主畫面 */

export function SwipeDemoScreen({
  screenWidth,
  photo,
  kept,
  discarded,
  processed,
  total,
  exiting,
  onExitDone,
  reducedMotion,
}: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  /** 決策徽章與方向描邊的顯示進度。 */
  const markProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!exiting) {
      // 換下一張時把所有動畫值歸零，上一個判定不會殘留在新照片上。
      translateX.setValue(0);
      opacity.setValue(1);
      markProgress.setValue(0);
      return;
    }

    if (reducedMotion) {
      // 不位移、不旋轉、不放大；只讓徽章短暫淡入，讓使用者知道判定結果。
      translateX.setValue(0);
      opacity.setValue(1);
      Animated.timing(markProgress, {
        toValue: 1,
        duration: REDUCED_HOLD_DURATION,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          markProgress.setValue(0);
          onExitDone();
        }
      });
      return;
    }

    const distance = exiting === 'discard' ? -screenWidth * 1.1 : screenWidth * 1.1;
    Animated.parallel([
      // 徽章先浮現，所以它和卡片起步是同一瞬間，不是事後才跳出來。
      Animated.timing(markProgress, {
        toValue: 1,
        duration: MARK_IN_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(translateX, {
        toValue: distance,
        duration: EXIT_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      // 卡片整體淡出，徽章在卡片內所以跟著一起消失，不需要另一段淡出動畫。
      Animated.timing(opacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        translateX.setValue(0);
        opacity.setValue(1);
        markProgress.setValue(0);
        onExitDone();
      }
    });
  }, [exiting, reducedMotion, screenWidth, translateX, opacity, markProgress, onExitDone]);

  const pad = Math.round(screenWidth * 0.055);
  const cardSize = screenWidth - pad * 2 - border.width * 2;

  // 與正式 SwipeCard 相同：位移換算成 ±8deg 傾斜。reduced motion 不旋轉。
  const rotate = reducedMotion
    ? '0deg'
    : translateX.interpolate({
        inputRange: [-screenWidth, 0, screenWidth],
        outputRange: ['-8deg', '0deg', '8deg'],
      });

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <View style={styles.header}>
        <Text
          style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          最近 30 天
        </Text>
        <Text
          style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {`${processed} / ${total}`}
        </Text>
      </View>

      <PixelProgress value={processed} total={total} />

      <View style={styles.stats}>
        <PixelBadge label="已保留" value={kept} tone="keep" />
        <PixelBadge label="待刪除" value={discarded} tone="discard" />
      </View>

      {/* 照片卡片。overflow 由 PixelSurface 的 clip 處理，色塊與徽章都不會溢出圓角。 */}
      <View style={styles.cardArea}>
        {photo ? (
          <Animated.View style={{ opacity, transform: [{ translateX }, { rotate }] }}>
            <PixelSurface clip cornerRadius={radius.lg} style={styles.card}>
              {/* 照片與決策徽章共用同一個正方形容器，徽章一定被裁在照片範圍內。 */}
              <View style={{ width: cardSize, height: cardSize }}>
                <DemoPhotoArt photo={photo} size={cardSize} />
                {exiting ? (
                  <DecisionOverlay
                    decision={exiting}
                    screenWidth={screenWidth}
                    progress={markProgress}
                    reducedMotion={reducedMotion}
                  />
                ) : null}
              </View>
              <View style={[styles.cardMeta, { width: cardSize }]}>
                <Text
                  style={[typeStyle(typeAccent.buttonSmall, screenWidth), styles.cardTitle]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                  {photo.title}
                </Text>
                <Text
                  style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
                  maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                  {photo.createdAt}
                </Text>
              </View>
            </PixelSurface>
          </Animated.View>
        ) : (
          <PixelSurface style={styles.done}>
            <CheckIcon size={32} fill={colors.keep} />
            <Text
              style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.cardTitle]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              這一批都整理完了
            </Text>
          </PixelSurface>
        )}
      </View>

      {/* 左右提示：對應正式版的「左滑待刪、右滑保留」。 */}
      <View style={styles.hints}>
        <View style={styles.hintRow}>
          <TrashIcon size={16} fill={colors.discard} />
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.hintDiscard]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            左滑：待刪除
          </Text>
        </View>
        <View style={styles.hintRow}>
          <UndoIcon size={16} fill={colors.textSecondary} />
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            可復原
          </Text>
        </View>
        <View style={styles.hintRow}>
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.hintKeep]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            右滑：保留
          </Text>
          <CheckIcon size={16} fill={colors.keep} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heading: {
    color: colors.textPrimary,
  },
  muted: {
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    padding: 0,
  },
  cardMeta: {
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  cardTitle: {
    color: colors.textPrimary,
  },
  done: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  /** 決策回饋層：蓋住整張照片，但不攔截點擊。 */
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.md,
    borderWidth: border.width,
  },
  tintKeep: {
    borderColor: colors.keep,
    borderRightWidth: border.width * 2,
  },
  tintDiscard: {
    borderColor: colors.discard,
    borderLeftWidth: border.width * 2,
  },
  badgeSlot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  badgeSlotKeep: {
    alignItems: 'flex-start',
  },
  badgeSlotDiscard: {
    alignItems: 'flex-end',
  },
  badge: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.ms,
  },
  badgeScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayScrim,
  },
  badgeText: {
    color: colors.surface,
    fontWeight: '700',
    letterSpacing: 2,
  },
  hints: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  hintDiscard: {
    color: colors.discardText,
  },
  hintKeep: {
    color: colors.keepText,
  },
});
