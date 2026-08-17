/**
 * 一個功能 Section 的版面 + 進場動畫。
 *
 * 版面：
 * - desktop `center`：標題與手機垂直置中一欄（Hero、Summary 用）
 * - desktop `text-left`：文字在左、手機在右
 * - desktop `text-right`：手機在左、文字在右
 * - tablet / mobile：一律「文字 → 手機」單欄
 *
 * 動畫：
 * 不使用 IntersectionObserver，改用「ScrollView 的捲動位置 + onLayout 量到的
 * 區塊位置」來判斷是否進入視窗。這樣 web 與 native 走同一條程式碼路徑，
 * 也完全不需要 DOM API，static export 預渲染時不會出錯。
 *
 * reduced motion 時 opacity/translate 直接是最終值，內容立刻完整顯示。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { useDemoLayout } from '@/components/demo/demo-shell';
import { colors, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export type DemoSectionAlign = 'center' | 'text-left' | 'text-right';

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** 手機 mockup。 */
  phone: ReactNode;
  /** 標題區下方的補充內容（操作按鈕、說明）。刻意保持少量。 */
  aside?: ReactNode;
  align?: DemoSectionAlign;
  /** 是否已進入視窗。由頁面統一計算後傳入。 */
  visible: boolean;
  reducedMotion: boolean;
  /** 量到這個 Section 在捲動內容中的 y 座標。 */
  onLayoutY?: (y: number) => void;
};

const REVEAL_DURATION = 620;
const PHONE_DURATION = 720;

export function DemoSection({
  eyebrow,
  title,
  subtitle,
  phone,
  aside,
  align = 'center',
  visible,
  reducedMotion,
  onLayoutY,
}: Props) {
  const { width, breakpoint, isDesktop } = useDemoLayout();

  // reduced motion 時直接從 1 開始，等於沒有動畫。
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    if (!visible) {
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: PHONE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [visible, reducedMotion, progress]);

  const textOpacity = progress.interpolate({ inputRange: [0, 0.7], outputRange: [0, 1], extrapolate: 'clamp' });
  const textTranslate = progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  const phoneOpacity = progress;
  const phoneTranslate = progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] });
  const phoneScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  const centered = align === 'center' || !isDesktop;
  const phoneFirst = isDesktop && align === 'text-right';

  const textBlock = (
    <Animated.View
      style={[
        centered ? styles.textCentered : styles.textColumn,
        { opacity: textOpacity, transform: [{ translateY: textTranslate }] },
      ]}>
      {eyebrow ? (
        <Text
          style={[typeStyle(typeAccent.badgeLabel, width), styles.eyebrow, centered ? styles.center : null]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {eyebrow}
        </Text>
      ) : null}
      <Text
        style={[
          styles.title,
          centered ? styles.center : null,
          {
            fontSize: titleSize(breakpoint),
            lineHeight: Math.round(titleSize(breakpoint) * 1.24),
          },
        ]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            centered ? styles.center : null,
            { fontSize: subtitleSize(breakpoint), lineHeight: Math.round(subtitleSize(breakpoint) * 1.6) },
          ]}
          maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
          {subtitle}
        </Text>
      ) : null}
      {aside ? <View style={[styles.aside, centered ? styles.asideCentered : null]}>{aside}</View> : null}
    </Animated.View>
  );

  const phoneBlock = (
    <Animated.View
      style={[
        styles.phoneWrap,
        {
          opacity: phoneOpacity,
          transform: [{ translateY: phoneTranslate }, { scale: phoneScale }],
        },
      ]}>
      {phone}
    </Animated.View>
  );

  return (
    <View
      onLayout={(event) => onLayoutY?.(event.nativeEvent.layout.y)}
      style={[
        styles.section,
        // 不寫死高度：用 minHeight 讓小螢幕能自然長高，不會裁切內容。
        { minHeight: breakpoint === 'mobile' ? undefined : 640, paddingVertical: breakpoint === 'mobile' ? spacing.xl * 1.5 : spacing.xl * 2.5 },
      ]}>
      <View style={[centered ? styles.stackCentered : styles.row]}>
        {phoneFirst ? (
          <>
            {phoneBlock}
            {textBlock}
          </>
        ) : (
          <>
            {textBlock}
            {phoneBlock}
          </>
        )}
      </View>
    </View>
  );
}

function titleSize(bp: 'mobile' | 'tablet' | 'desktop'): number {
  return bp === 'desktop' ? 46 : bp === 'tablet' ? 38 : 31;
}
function subtitleSize(bp: 'mobile' | 'tablet' | 'desktop'): number {
  return bp === 'desktop' ? 18 : bp === 'tablet' ? 17 : 15;
}

const styles = StyleSheet.create({
  section: {
    justifyContent: 'center',
    width: '100%',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xl * 2,
    justifyContent: 'space-between',
    width: '100%',
  },
  stackCentered: {
    alignItems: 'center',
    gap: spacing.xl,
    width: '100%',
  },
  textColumn: {
    flexShrink: 1,
    gap: spacing.ms,
    // 桌面雙欄時文字不要拉太寬，維持易讀行長。
    maxWidth: 520,
  },
  textCentered: {
    alignItems: 'center',
    gap: spacing.ms,
    maxWidth: 660,
    width: '100%',
  },
  center: {
    textAlign: 'center',
  },
  eyebrow: {
    color: colors.primaryText,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#3B2C63',
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  aside: {
    paddingTop: spacing.sm,
    width: '100%',
  },
  asideCentered: {
    alignItems: 'center',
  },
  phoneWrap: {
    alignItems: 'center',
  },
});
