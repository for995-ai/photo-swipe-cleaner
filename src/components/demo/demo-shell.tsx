/**
 * Portfolio Demo 的外層容器。
 *
 * 負責：柔和背景（奶油白 + 淡粉 + 淡紫的裝飾光暈）、置中的 max-width、
 * Section 間距、Demo Mode badge、以及一組跨平台的斷點與 reduced-motion 判斷。
 *
 * 背景刻意用「疊層的大圓形 View」而不是 CSS gradient：
 * 這樣 web 與 native 表現一致，也不需要為了 Demo 引入任何漸層套件。
 *
 * SSR 安全：window／document／matchMedia 全部只在 mount 後、且 Platform.OS === 'web'
 * 的分支裡讀取，module scope 沒有任何瀏覽器 API。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { border, colors, radius, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

/** 桌面內容最大寬度。 */
export const DEMO_MAX_WIDTH = 1320;

export type DemoBreakpoint = 'mobile' | 'tablet' | 'desktop';

/**
 * 依視窗寬度決定斷點。
 *
 * static export 會在 Node 預渲染，此時拿不到真實寬度（可能是 0），
 * 所以 0 一律當桌面處理：預渲染出的 HTML 是桌面版，掛載後再自行修正。
 */
export function useDemoLayout(): {
  width: number;
  breakpoint: DemoBreakpoint;
  isDesktop: boolean;
  phoneWidth: number;
} {
  const { width: rawWidth } = useWindowDimensions();
  const width = rawWidth > 0 ? rawWidth : DEMO_MAX_WIDTH;

  const breakpoint: DemoBreakpoint = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';

  // 手機外框寬度：桌面固定、平板縮小、手機吃滿但留邊。
  const phoneWidth =
    breakpoint === 'desktop'
      ? 352
      : breakpoint === 'tablet'
        ? 320
        : Math.min(width - spacing.lg * 2, 390);

  return { width, breakpoint, isDesktop: breakpoint === 'desktop', phoneWidth };
}

/**
 * 使用者是否要求減少動態效果。
 *
 * web 才有 prefers-reduced-motion；native 沒有這個查詢，
 * 一律回 true（直接顯示、不做進場動畫），這也是最安全的降級。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    // 只在 mount 後讀取，避免 static export 在 Node 端碰到 matchMedia。
    const media = typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    if (!media) {
      setReduced(false);
      return;
    }
    setReduced(media.matches);
    const onChange = (event: { matches: boolean }) => setReduced(event.matches);
    // Safari 舊版只有 addListener。
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange as (e: MediaQueryListEvent) => void);
      return () => media.removeEventListener('change', onChange as (e: MediaQueryListEvent) => void);
    }
    return undefined;
  }, []);

  return reduced;
}

/** 右上角的小型標示，明確告知這不是在操作真實相簿。 */
export function DemoModeBadge() {
  const { width } = useDemoLayout();
  return (
    <View style={styles.badge}>
      <View style={styles.badgeDot} />
      <Text
        style={[typeStyle(typeAccent.badgeLabel, width), styles.badgeText]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        Portfolio Demo
      </Text>
    </View>
  );
}

export function DemoShell({ children }: { children: ReactNode }) {
  const { width, breakpoint } = useDemoLayout();
  const pad = breakpoint === 'mobile' ? spacing.lg : spacing.xl;

  return (
    <View style={styles.root}>
      {/*
        裝飾光暈。pointerEvents:none 確保它們永遠不會攔截捲動或點擊。
        用超大 borderRadius 的半透明圓形模擬 radial gradient。
      */}
      <View style={[StyleSheet.absoluteFill, styles.decorLayer]}>
        <View style={[styles.blob, { top: -width * 0.35, left: -width * 0.2, width: width * 0.95, height: width * 0.95, backgroundColor: '#FBE4ED' }]} />
        <View style={[styles.blob, { top: width * 0.25, right: -width * 0.3, width: width * 0.9, height: width * 0.9, backgroundColor: '#E7D8FF' }]} />
        <View style={[styles.blob, { top: width * 1.1, left: -width * 0.25, width: width * 0.85, height: width * 0.85, backgroundColor: '#F3E9FF' }]} />
      </View>

      <View style={[styles.container, { maxWidth: DEMO_MAX_WIDTH, paddingHorizontal: pad }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // 奶油白基底，與正式 App 同一個底色。
    backgroundColor: colors.background,
    width: '100%',
  },
  container: {
    alignSelf: 'center',
    width: '100%',
  },
  /** 裝飾層永遠不攔截捲動或點擊。style.pointerEvents 是 RN 0.71+ 的寫法。 */
  decorLayer: {
    pointerEvents: 'none',
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.55,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderRadius: radius.sm,
    borderWidth: border.width,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeDot: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  badgeText: {
    color: colors.primaryText,
    letterSpacing: 0.6,
  },
});
