/**
 * 像素風容器：2px 描邊 + 4px 無模糊硬陰影 + 小圓角。
 *
 * 陰影刻意用「一層位移的實色 View」而不是 iOS shadow* 或 Android elevation：
 * - shadowRadius / elevation 都會產生柔和模糊，不是我們要的硬陰影
 * - 位移 View 在 iOS 與 Android 表現完全一致
 * - 不會被父層的 overflow: hidden 裁掉
 *
 * 版面上用 marginRight／marginBottom 預留陰影空間，
 * 所以「內容 + 陰影」的總footprint 等於原本的盒子大小，不會擠壞既有排版。
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { border, colors, radius, shadow } from '@/lib/theme';

export type PixelSurfaceProps = {
  children?: ReactNode;
  /** 內容底色，預設 surface。 */
  background?: string;
  /** 描邊顏色，預設 outline。 */
  outlineColor?: string;
  /** 描邊寬度，預設 2px。 */
  outlineWidth?: number;
  /** 圓角，預設 md(8)。 */
  cornerRadius?: number;
  /** 陰影位移；0 表示不畫陰影（停用態、次級元素）。 */
  shadowOffset?: number;
  /** 陰影顏色，預設與描邊同色。 */
  shadowColor?: string;
  /** 內容區樣式（padding、flexDirection 等）。 */
  style?: StyleProp<ViewStyle>;
  /** 外框樣式（flex、margin 等版面相關）。 */
  wrapperStyle?: StyleProp<ViewStyle>;
  /** 內容是否需要裁切（例如放照片時）。 */
  clip?: boolean;
};

export function PixelSurface({
  children,
  background = colors.surface,
  outlineColor = colors.outline,
  outlineWidth = border.width,
  cornerRadius = radius.md,
  shadowOffset = shadow.offset,
  shadowColor = colors.shadow,
  style,
  wrapperStyle,
  clip = false,
}: PixelSurfaceProps) {
  const hasShadow = shadowOffset > 0;

  return (
    <View
      style={[
        styles.wrapper,
        hasShadow ? { marginRight: shadowOffset, marginBottom: shadowOffset } : null,
        wrapperStyle,
      ]}>
      {hasShadow ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: shadowColor,
              borderRadius: cornerRadius,
              transform: [{ translateX: shadowOffset }, { translateY: shadowOffset }],
            },
          ]}
        />
      ) : null}

      <View
        style={[
          {
            backgroundColor: background,
            borderColor: outlineColor,
            borderWidth: outlineWidth,
            borderRadius: cornerRadius,
          },
          clip && styles.clip,
          style,
        ]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  clip: {
    overflow: 'hidden',
  },
});
