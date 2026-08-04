import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Platform,
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

import { colors, radius, scaleFont, spacing } from '@/lib/theme';

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
 * 主標題。刻意用 numberOfLines + adjustsFontSizeToFit 收斂字級，
 * 避免最後一個字被擠到單獨一行。
 */
export function Title({ children, lines = 2 }: { children: ReactNode; lines?: number }) {
  const { width } = useWindowDimensions();
  const fontSize = scaleFont(26, width);
  return (
    <Text
      style={[styles.title, { fontSize, lineHeight: Math.round(fontSize * 1.35) }]}
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.8}>
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const { width } = useWindowDimensions();
  return (
    <Text
      style={[
        styles.body,
        { fontSize: scaleFont(16, width), color: muted ? colors.textMuted : colors.text },
      ]}>
      {children}
    </Text>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <Text style={[styles.caption, { fontSize: scaleFont(13, width) }]}>{children}</Text>;
}

/** 提示卡：用於有限存取、拒絕、空相簿、錯誤等狀態說明。 */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const accent = {
    info: colors.accent,
    warning: colors.warning,
    danger: colors.discard,
    success: colors.keep,
  }[tone];

  return (
    <View style={[styles.notice, { borderLeftColor: accent }]}>
      {title ? (
        <Text style={[styles.noticeTitle, { color: accent, fontSize: scaleFont(14, width) }]}>
          {title}
        </Text>
      ) : null}
      <Text style={[styles.noticeBody, { fontSize: scaleFont(14, width) }]}>{children}</Text>
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}) {
  const { width } = useWindowDimensions();

  const handlePress = () => {
    if (Platform.OS !== 'web') {
      // 觸覺回饋失敗不應影響操作，例如模擬器或不支援的裝置。
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}>
      <Text
        style={[
          styles.buttonLabel,
          // ghost 用小一號字＋窄一點的內距，並排時才不會被截成「重新開始本次…」
          { fontSize: scaleFont(variant === 'ghost' ? 14 : 16, width) },
          variant === 'primary' && styles.buttonLabelPrimary,
          variant === 'ghost' && styles.buttonLabelGhost,
          disabled && styles.buttonLabelDisabled,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}>
        {label}
      </Text>
    </Pressable>
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
  tone: 'keep' | 'discard' | 'info' | 'warning' | 'neutral';
}) {
  const { width } = useWindowDimensions();
  const color = {
    keep: colors.keep,
    discard: colors.discard,
    info: colors.accent,
    warning: colors.warning,
    neutral: colors.textMuted,
  }[tone];
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipLabel, { fontSize: scaleFont(12, width) }]}>{label}</Text>
      <Text style={[styles.chipValue, { color, fontSize: scaleFont(13, width) }]}>{value}</Text>
    </View>
  );
}

export function ProgressBar({ value, total }: { value: number; total: number }) {
  const ratio = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

/**
 * 底部整理按鈕（圖示 + 文字）。
 * 這裡不做觸覺回饋：決定完成時由卡片動畫統一觸發，避免震兩次。
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
  const accent =
    tone === 'keep' ? colors.keep : tone === 'discard' ? colors.discard : colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { borderColor: disabled ? colors.border : accent },
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.actionDisabled,
      ]}>
      <View style={disabled && styles.actionIconDisabled}>{icon}</View>
      <Text
        style={[
          styles.actionLabel,
          { color: disabled ? colors.textMuted : accent, fontSize: scaleFont(13, width) },
        ]}
        numberOfLines={1}>
        {label}
      </Text>
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
    color: colors.text,
    fontWeight: '700',
    lineHeight: 38,
  },
  body: {
    lineHeight: 24,
  },
  caption: {
    color: colors.textMuted,
    lineHeight: 19,
  },
  notice: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    gap: spacing.xs,
    padding: spacing.md,
  },
  noticeTitle: {
    fontWeight: '600',
  },
  noticeBody: {
    color: colors.textMuted,
    lineHeight: 21,
  },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonGhost: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  buttonLabelPrimary: {
    color: colors.accentText,
  },
  buttonLabelGhost: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  buttonLabelDisabled: {
    color: colors.textMuted,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  chipLabel: {
    color: colors.textMuted,
  },
  chipValue: {
    fontWeight: '700',
  },
  progressTrack: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 2,
    height: '100%',
  },
  action: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 3,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 62,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionDisabled: {
    backgroundColor: colors.background,
  },
  actionIconDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontWeight: '600',
  },
});
