/**
 * 像素風載入指示：四個方塊依序亮起。
 *
 * 刻意做得很輕：單一 Animated.Value 跑原生驅動的 0 -> 4 循環，
 * 每個方塊用 interpolate 取自己的透明度，過程中不觸發任何 re-render。
 * 沒有粒子、沒有閃爍、沒有旋轉。
 *
 * 這裡的區間一律寫成固定表格，不用 step 動態相加。
 * 之前用 [step, step + 1, step + 2, BLOCKS] 計算，step = 3 時會算出
 * [3, 4, 5, 4]，違反 Animated 要求的「inputRange 必須單調不遞減」而在實機 crash。
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors, iconSize, pixel } from '@/lib/theme';

/** 循環長度：驅動值從 0 跑到 4。 */
const CYCLE_END = 4;
const CYCLE_MS = 900;
/** 未亮起時的透明度。 */
const DIM = 0.3;

type Pulse = { inputRange: number[]; outputRange: number[] };

/**
 * 每一格的亮度區間，全部固定且嚴格遞增。
 * 第 0 格橫跨循環接縫（開頭亮、結尾回到亮），所以區間長相和其他三格不同。
 */
const PULSES: readonly Pulse[] = [
  { inputRange: [0, 0.5, 1, 3.5, CYCLE_END], outputRange: [1, 1, DIM, DIM, 1] },
  { inputRange: [0, 0.5, 1, 1.5, CYCLE_END], outputRange: [DIM, DIM, 1, DIM, DIM] },
  { inputRange: [0, 1.5, 2, 2.5, CYCLE_END], outputRange: [DIM, DIM, 1, DIM, DIM] },
  { inputRange: [0, 2.5, 3, 3.5, CYCLE_END], outputRange: [DIM, DIM, 1, DIM, DIM] },
];

/**
 * 版面順序：flexWrap 的兩欄網格依序是 左上、右上、左下、右下。
 * 想讓亮點順時針跑一圈（左上 -> 右上 -> 右下 -> 左下），
 * 左下要用第 3 段、右下用第 2 段。
 */
const GRID_ORDER: readonly number[] = [0, 1, 3, 2];

/**
 * 開發期防禦：確認每組區間長度一致且單調不遞減。
 * 包在 __DEV__ 裡，production bundle 會整段移除。
 */
if (__DEV__) {
  PULSES.forEach((pulse, index) => {
    if (pulse.inputRange.length !== pulse.outputRange.length) {
      console.warn(
        `[PixelSpinner] 第 ${index} 格的 inputRange/outputRange 長度不一致`,
        pulse.inputRange.length,
        pulse.outputRange.length
      );
    }
    for (let i = 1; i < pulse.inputRange.length; i += 1) {
      if (pulse.inputRange[i] < pulse.inputRange[i - 1]) {
        console.warn(
          `[PixelSpinner] 第 ${index} 格的 inputRange 不是單調不遞減`,
          pulse.inputRange
        );
        break;
      }
    }
  });

  if (GRID_ORDER.length !== PULSES.length) {
    console.warn('[PixelSpinner] GRID_ORDER 與 PULSES 數量不一致');
  }
}

export function PixelSpinner({
  size = iconSize.md,
  color = colors.primary,
}: {
  size?: number;
  color?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: CYCLE_END,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const block = Math.max(Math.floor(size / 2 / pixel.unit) * pixel.unit, pixel.unit * 2);
  const gap = pixel.unit;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="載入中"
      style={[styles.grid, { width: block * 2 + gap, height: block * 2 + gap, gap }]}>
      {GRID_ORDER.map((pulseIndex, position) => {
        const pulse = PULSES[pulseIndex];
        return (
          <Animated.View
            key={position}
            style={{
              backgroundColor: color,
              borderColor: colors.outline,
              borderWidth: 1,
              height: block,
              width: block,
              opacity: progress.interpolate({
                inputRange: pulse.inputRange,
                outputRange: pulse.outputRange,
                extrapolate: 'clamp',
              }),
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
