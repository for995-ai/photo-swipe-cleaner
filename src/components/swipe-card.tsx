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
import { colors, radius, scaleFont, spacing } from '@/lib/theme';

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

  const badgeFont = scaleFont(15, width);

  return (
    <Animated.View
      style={[styles.card, { opacity, transform: [{ translateX }, { rotate }] }]}
      {...panResponder.panHandlers}>
      {failed ? (
        <View style={styles.fallback}>
          <Text style={[styles.fallbackTitle, { fontSize: scaleFont(16, width) }]}>
            這張照片無法載入
          </Text>
          <Text style={[styles.fallbackBody, { fontSize: scaleFont(13, width) }]}>
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

      <Animated.View
        pointerEvents="none"
        style={[styles.tint, { borderColor: colors.keep, opacity: keepOpacity }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.tint, { borderColor: colors.discard, opacity: discardOpacity }]}
      />

      <Animated.View pointerEvents="none" style={[styles.badgeSlot, { opacity: keepOpacity }]}>
        <View style={[styles.badge, { borderColor: colors.keep }]}>
          <CheckIcon size={badgeFont * 1.5} color={colors.keep} />
          <Text style={[styles.badgeText, { color: colors.keep, fontSize: badgeFont }]}>保留</Text>
        </View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.badgeSlot, { opacity: discardOpacity }]}>
        <View style={[styles.badge, { borderColor: colors.discard }]}>
          <TrashIcon size={badgeFont * 1.5} color={colors.discard} />
          <Text style={[styles.badgeText, { color: colors.discard, fontSize: badgeFont }]}>
            待刪除
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flex: 1,
    overflow: 'hidden',
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  badgeSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(14, 16, 20, 0.82)',
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  badgeText: {
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
    color: colors.text,
    fontWeight: '600',
  },
  fallbackBody: {
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
});
