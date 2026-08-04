import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { CheckIcon, TrashIcon } from '@/components/icons';
import type { RecentPhoto } from '@/lib/photos';
import type { Decision } from '@/lib/session';
import { border, colors, iconSize, radius, scaleFont, shadow, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeScale, typeStyle } from '@/lib/typography';

/** 需要滑動超過螢幕寬度的比例才算確認，未達門檻就回彈。 */
const CONFIRM_RATIO = 0.25;
const EXIT_DURATION = 190;
const FADE_IN_DURATION = 140;

export type SwipeCardHandle = {
  /** 底部按鈕與手勢共用這支方法，確保兩條路徑完全一致。 */
  swipeOut: (decision: Decision) => void;
};

type Props = {
  photo: RecentPhoto;
  onDecided: (decision: Decision) => void;
  onBusyChange: (busy: boolean) => void;
  onLoadError: () => void;
  failed: boolean;
};

export const SwipeCard = forwardRef<SwipeCardHandle, Props>(function SwipeCard(
  { photo, onDecided, onBusyChange, onLoadError, failed },
  ref
) {
  const { width } = useWindowDimensions();
  const threshold = Math.max(width * CONFIRM_RATIO, 48);
  const exitDistance = width * 1.15;

  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // 動畫進行中會鎖住輸入，避免連續操作造成索引錯亂。
  const busy = useRef(false);
  // PanResponder 只建立一次，所以每次 render 都把最新值寫進 ref。
  const latest = useRef({ threshold, exitDistance, onDecided, onBusyChange });
  latest.current = { threshold, exitDistance, onDecided, onBusyChange };

  const springBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
  };

  const swipeOut = (decision: Decision) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    latest.current.onBusyChange(true);

    if (Platform.OS !== 'web') {
      // 確認判定時給一下輕微的觸覺回饋；失敗不影響操作。
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    const target =
      decision === 'discard' ? -latest.current.exitDistance : latest.current.exitDistance;

    Animated.parallel([
      Animated.timing(translateX, {
        toValue: target,
        duration: EXIT_DURATION,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // 先把卡片歸位再切換照片，下一張才不會從畫面外閃進來。
      translateX.setValue(0);
      latest.current.onDecided(decision);
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_IN_DURATION,
        useNativeDriver: true,
      }).start(() => {
        busy.current = false;
        latest.current.onBusyChange(false);
      });
    });
  };

  const swipeOutRef = useRef(swipeOut);
  swipeOutRef.current = swipeOut;

  useImperativeHandle(ref, () => ({
    swipeOut: (decision: Decision) => swipeOutRef.current(decision),
  }));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !busy.current &&
          Math.abs(gesture.dx) > 6 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          if (!busy.current) {
            translateX.setValue(gesture.dx);
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          if (busy.current) {
            return;
          }
          if (gesture.dx <= -latest.current.threshold) {
            swipeOutRef.current('discard');
          } else if (gesture.dx >= latest.current.threshold) {
            swipeOutRef.current('keep');
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: () => {
          if (!busy.current) {
            springBack();
          }
        },
      }),
    // translateX 是穩定的 Animated.Value，其餘可變值都走 latest ref。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const rotate = translateX.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-8deg', '0deg', '8deg'],
  });
  const keepOpacity = translateX.interpolate({
    inputRange: [0, threshold],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const discardOpacity = translateX.interpolate({
    inputRange: [-threshold, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // 疊在照片上的方向徽章：字級跟著裝置寬度縮放，並補上 lineHeight，
  // 放大字級時中文字不會被徽章上下邊裁到。
  const badgeFont = scaleFont(15, width);
  const badgeLine = Math.round(badgeFont * 1.3);

  return (
    // 手勢層：flex:1 佔滿 stage、沒有 margin、沒有 overflow: hidden，
    // 所以觸控範圍與改版前完全相同，硬陰影也不會被裁掉。
    <Animated.View
      style={[styles.card, { opacity, transform: [{ translateX }, { rotate }] }]}
      {...panResponder.panHandlers}>
      {/* 硬陰影畫在裁切層外面：位移 4px 的實色方塊，無模糊。 */}
      <View pointerEvents="none" style={styles.cardShadow} />

      {/* 只有這一層裁切照片。 */}
      <View style={styles.cardInner}>
        {failed ? (
          <View style={styles.fallback}>
            <Text
              style={[typeStyle(typeAccent.button, width), styles.fallbackTitle]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              這張照片無法載入
            </Text>
            <Text
              style={[typeStyle(typeScale.caption, width), styles.fallbackBody]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              可能仍存放在 iCloud 或已被移除，仍然可以左右滑動做決定。
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: photo.uri }}
            style={styles.photo}
            // aspectFit：完整顯示整張照片，不為了填滿而裁切。
            contentFit="contain"
            allowDownscaling
            recyclingKey={photo.id}
            cachePolicy="memory-disk"
            onError={onLoadError}
          />
        )}

        {/* 方向側加粗到 4px：右滑強調右邊、左滑強調左邊。疊在上層，不影響卡片尺寸。 */}
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, styles.tintKeep, { opacity: keepOpacity }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, styles.tintDiscard, { opacity: discardOpacity }]}
        />

        <Animated.View pointerEvents="none" style={[styles.badgeSlot, { opacity: keepOpacity }]}>
          <View style={styles.badge}>
            {/* 兩層 overlayScrim 疊出足夠不透明度，淺色文字在任何照片上都讀得到。 */}
            <View pointerEvents="none" style={styles.badgeScrim} />
            <CheckIcon size={iconSize.lg} fill={colors.keep} />
            <Text
              style={[styles.badgeText, { fontSize: badgeFont, lineHeight: badgeLine }]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              保留
            </Text>
          </View>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.badgeSlot, { opacity: discardOpacity }]}>
          <View style={styles.badge}>
            <View pointerEvents="none" style={styles.badgeScrim} />
            <TrashIcon size={iconSize.lg} fill={colors.discard} />
            <Text
              style={[styles.badgeText, { fontSize: badgeFont, lineHeight: badgeLine }]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              待刪除
            </Text>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  /** 手勢層：不裁切、不加 margin，維持原本的觸控範圍。 */
  card: {
    flex: 1,
  },
  cardShadow: {
    backgroundColor: colors.shadow,
    borderRadius: radius.md,
    bottom: 0,
    left: shadow.offset,
    position: 'absolute',
    right: 0,
    top: shadow.offset,
  },
  /** 唯一裁切照片的一層，向右下讓出 4px 讓陰影露出來。 */
  cardInner: {
    backgroundColor: colors.surface,
    borderColor: colors.outline,
    borderRadius: radius.md,
    borderWidth: border.width,
    flex: 1,
    marginBottom: shadow.offset,
    marginRight: shadow.offset,
    overflow: 'hidden',
  },
  photo: {
    flex: 1,
    width: '100%',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.overlayScrim,
    borderColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: border.width,
    gap: spacing.sm,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
  fallback: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  fallbackTitle: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  fallbackBody: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
