/**
 * 共用 UI 元件。
 *
 * Beta 0.4：內部改用 components/pixel/* 的像素風實作，
 * 但所有元件的對外 props、variant 與 tone 名稱完全不變，
 * 因此各頁面不需要任何修改就會換皮。
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PixelBadge, type PixelBadgeTone } from '@/components/pixel/pixel-badge';
import { PixelButton, type PixelButtonTone } from '@/components/pixel/pixel-button';
import { PixelNotice, type PixelNoticeTone } from '@/components/pixel/pixel-notice';
import { PixelProgress } from '@/components/pixel/pixel-progress';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { colors, radius, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeScale, typeStyle } from '@/lib/typography';

/**
 * 畫面外框：套用 Safe Area 並可選擇是否捲動。
 * 小尺寸 iPhone 內容變高時用 scroll 版本，避免溢位。
 */
export function Screen({
  children,
  scroll = false,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.md,
    paddingLeft: Math.max(insets.left, spacing.lg),
    paddingRight: Math.max(insets.right, spacing.lg),
  };

  if (scroll) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.scrollContent, padding, style]}
        alwaysBounceVertical={false}>
        {children}
      </ScrollView>
    );
  }

  return <View style={[styles.screen, padding, style]}>{children}</View>;
}

/**
 * 主標題。
 *
 * 階段 9 移除 adjustsFontSizeToFit / minimumFontScale：
 * 那組屬性會在使用者放大字級時把標題縮回原尺寸，Dynamic Type 等於失效。
 * 標題本來就短，放大時直接換行即可，預設留 3 行的空間。
 */
export function Title({ children, lines = 3 }: { children: ReactNode; lines?: number }) {
  const { width } = useWindowDimensions();
  return (
    <Text
      style={[typeStyle(typeScale.title, width), styles.title]}
      numberOfLines={lines}
      maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const { width } = useWindowDimensions();
  return (
    <Text
      style={[
        typeStyle(typeScale.body, width),
        { color: muted ? colors.textSecondary : colors.textPrimary },
      ]}
      maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
      {children}
    </Text>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <Text
      style={[typeStyle(typeScale.caption, width), styles.caption]}
      maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
      {children}
    </Text>
  );
}

/** 提示卡：用於有限存取、拒絕、空相簿、錯誤等狀態說明。 */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: PixelNoticeTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <PixelNotice tone={tone} title={title}>
      {children}
    </PixelNotice>
  );
}

/** variant 名稱不變，只是對應到像素風的 tone。 */
const BUTTON_TONE: Record<'primary' | 'secondary' | 'ghost' | 'danger', PixelButtonTone> = {
  primary: 'primary',
  secondary: 'neutral',
  ghost: 'plain',
  danger: 'discard',
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  return (
    <PixelButton
      label={label}
      onPress={onPress}
      tone={BUTTON_TONE[variant]}
      disabled={disabled}
    />
  );
}

/** 統計小標籤：保留／待刪除／解析狀態數量。 */
export function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: PixelBadgeTone;
}) {
  return <PixelBadge label={label} value={value} tone={tone} />;
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  return (
    <PixelProgress
      value={value}
      total={total}
      accessibilityLabel={`已處理 ${value} / 約 ${total} 張`}
    />
  );
}

/**
 * 底部整理按鈕（圖示 + 文字）。
 * 這裡不做觸覺回饋：決定完成時由卡片動畫統一觸發，避免震兩次。
 *
 * 本輪只套用共用描邊、硬陰影與按壓效果，圖示與尺寸維持原樣。
 */
export function ActionButton({
  label,
  icon,
  tone,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  tone: 'keep' | 'discard' | 'neutral';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { width } = useWindowDimensions();
  // 文字前景要用深色版本；粉彩本色留給傳入的圖示與裝飾。
  const labelColor =
    tone === 'keep'
      ? colors.keepText
      : tone === 'discard'
        ? colors.discardText
        : colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}>
      {({ pressed }) => {
        const active = pressed && !disabled;
        const offset = disabled ? 0 : active ? shadow.pressOffset : shadow.offset;

        return (
          <PixelSurface
            background={disabled ? colors.disabledSurface : colors.surface}
            outlineColor={disabled ? colors.disabledText : colors.outline}
            cornerRadius={radius.md}
            shadowOffset={offset}
            style={[
              styles.action,
              active ? { transform: [{ translateY: shadow.pressOffset }] } : null,
            ]}>
            <View style={disabled ? styles.actionIconDisabled : undefined}>{icon}</View>
            <Text
              style={[
                typeStyle(typeAccent.badgeValue, width),
                styles.actionLabel,
                { color: disabled ? colors.disabledText : labelColor },
              ]}
              /**
               * 這裡是唯一保留縮字的地方：三顆按鈕平分寬度、旁邊還有 32px 圖示，
               * 換行會把照片區推高。改成先換行、真的放不下才縮字，
               * 下限拉高到 0.9（13pt → 至少 11.7pt），不會縮到難以閱讀。
               */
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.9}
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
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  title: {
    color: colors.textPrimary,
  },
  caption: {
    color: colors.textSecondary,
  },
  /**
   * 圖示與標籤改為橫向排列。
   * 這樣 32px 圖示放得進來，總高度反而從 62 降到 52（48 + 4px 陰影），
   * 省下的 10px 全部還給照片區，觸控高度仍遠超過 44pt。
   */
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionLabel: {
    flexShrink: 1,
  },
  actionIconDisabled: {
    opacity: 0.4,
  },
});
