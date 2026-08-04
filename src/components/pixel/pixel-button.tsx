/**
 * 像素風按鈕：2px 描邊 + 4px 硬陰影，按下時內容下移 2px、陰影縮到 2px。
 * 沒有模糊、漸層或光暈。
 *
 * 粉彩底色的亮度都偏高（白字對比僅約 2.5:1），所以有色底一律用深色文字。
 */
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PixelSurface } from '@/components/pixel/pixel-surface';
import { border, colors, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export type PixelButtonTone = 'primary' | 'neutral' | 'keep' | 'discard' | 'plain';

export type PixelButtonProps = {
  label: string;
  onPress: () => void;
  tone?: PixelButtonTone;
  disabled?: boolean;
  /** plain（無描邊無陰影的文字按鈕）用小一號字。 */
  compact?: boolean;
  /** 是否觸發輕微觸覺回饋。 */
  haptics?: boolean;
  icon?: ReactNode;
  wrapperStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

function toneBackground(tone: PixelButtonTone): string {
  switch (tone) {
    case 'primary':
      return colors.primary;
    case 'keep':
      return colors.keep;
    case 'discard':
      return colors.discard;
    case 'neutral':
      return colors.surface;
    case 'plain':
      return 'transparent';
  }
}

export function PixelButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  compact = false,
  haptics = true,
  icon,
  wrapperStyle,
  accessibilityLabel,
}: PixelButtonProps) {
  const { width } = useWindowDimensions();
  const isPlain = tone === 'plain';

  const handlePress = () => {
    if (haptics && Platform.OS !== 'web') {
      // 觸覺回饋失敗不應影響操作，例如模擬器或不支援的裝置。
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress();
  };

  const labelStyle = typeStyle(
    compact || isPlain ? typeAccent.buttonSmall : typeAccent.button,
    width
  );

  const labelColor = disabled
    ? colors.disabledText
    : isPlain
      ? colors.textSecondary
      : colors.onColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={wrapperStyle}>
      {({ pressed }) => {
        const active = pressed && !disabled;
        // 停用態不畫陰影；plain 從頭到尾都沒有描邊與陰影。
        const offset = isPlain || disabled ? 0 : active ? shadow.pressOffset : shadow.offset;

        return (
          <PixelSurface
            background={disabled && !isPlain ? colors.disabledSurface : toneBackground(tone)}
            outlineColor={disabled ? colors.disabledText : colors.outline}
            outlineWidth={isPlain ? 0 : border.width}
            cornerRadius={radius.md}
            shadowOffset={offset}
            style={[
              styles.content,
              isPlain ? styles.contentPlain : null,
              // 內容下移 2px，配合陰影縮短，讀起來就是「被按下去」。
              active ? { transform: [{ translateY: shadow.pressOffset }] } : null,
            ]}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              style={[labelStyle, styles.label, { color: labelColor }]}
              /**
               * 階段 9：改成「可換行」而不是「縮字」。
               * 原本 numberOfLines={1} + adjustsFontSizeToFit 會在放大字級時
               * 反過來把字縮回去，等於抵銷 Dynamic Type；長標籤（例如
               * 「儲存進度並返回首頁」「繼續整理：相簿名稱」）在最大字級下
               * 還是會被截成「…」。現在讓按鈕自己長高，字級一律照使用者設定。
               */
              numberOfLines={2}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {label}
            </Text>
          </PixelSurface>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.ms,
  },
  contentPlain: {
    // 維持 44pt 觸控目標；plain 沒有陰影，所以總高度就是 44。
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
