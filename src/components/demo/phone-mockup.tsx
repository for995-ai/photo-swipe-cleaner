/**
 * 可重用的 iPhone 外框。
 *
 * 全部用 View 畫成，不使用任何 iPhone 圖片素材：
 * - 黑色機身 + 大圓角 + Dynamic Island
 * - 內層螢幕以 overflow:hidden + borderRadius 裁切，內容不會溢出圓角
 * - 比例固定 393 : 852（iPhone 15 Pro 的 point 尺寸），縮放時不變形
 *
 * 尺寸只由 `width` 決定，高度一律由比例算出，所以在任何斷點都不會被拉扁。
 */
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@/lib/theme';
import { textScaling } from '@/lib/typography';

/** iPhone 15 Pro 的邏輯解析度，用來鎖住長寬比。 */
const BASE_WIDTH = 393;
const BASE_HEIGHT = 852;
const ASPECT = BASE_HEIGHT / BASE_WIDTH;

/** 機身外框厚度與圓角，都按 width 等比縮放，避免小尺寸時邊框顯得過粗。 */
const FRAME_RATIO = 0.028;
const OUTER_RADIUS_RATIO = 0.135;

type Props = {
  width: number;
  children: ReactNode;
  /** 螢幕頂端的狀態列文字，預設 9:41。 */
  statusTime?: string;
  /** 是否顯示狀態列。關掉可讓螢幕內容自己從頂端開始。 */
  showStatusBar?: boolean;
};

export function PhoneMockup({ width, children, statusTime = '9:41', showStatusBar = true }: Props) {
  const height = Math.round(width * ASPECT);
  const frame = Math.max(Math.round(width * FRAME_RATIO), 8);
  const outerRadius = Math.round(width * OUTER_RADIUS_RATIO);
  const screenRadius = Math.max(outerRadius - frame, 8);

  // Dynamic Island 也按比例縮放，並保留在螢幕內側頂端。
  const islandWidth = Math.round(width * 0.3);
  const islandHeight = Math.round(width * 0.082);
  const islandTop = Math.round(width * 0.032);

  /** 狀態列高度：要能容納 Dynamic Island，否則內容會被它蓋住。 */
  const statusBarHeight = islandTop + islandHeight + Math.round(width * 0.022);

  return (
    <View
      // 整支手機是一張示意圖，語意上交給外層 Section 描述。
      accessible={false}
      style={[
        styles.body,
        {
          width,
          height,
          borderRadius: outerRadius,
          padding: frame,
        },
      ]}>
      <View
        style={[
          styles.screen,
          {
            borderRadius: screenRadius,
            // 內容一定要被裁在圓角內。
            overflow: 'hidden',
          },
        ]}>
        {showStatusBar ? (
          <View style={{ height: statusBarHeight, paddingHorizontal: Math.round(width * 0.07) }}>
            <View style={styles.statusRow}>
              <Text
                style={[styles.statusText, { fontSize: Math.max(Math.round(width * 0.036), 10) }]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {statusTime}
              </Text>
              <Text
                style={[styles.statusText, { fontSize: Math.max(Math.round(width * 0.036), 10) }]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                ▪▪▪ ᯤ ▮
              </Text>
            </View>
          </View>
        ) : null}

        {/* 螢幕內容。flex:1 讓每個 demo screen 自己決定版面。 */}
        <View style={styles.content}>{children}</View>

        {/*
          Dynamic Island 疊在最上層，但 pointerEvents:none，
          所以不會攔截下方內容的點擊。
        */}
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: islandTop,
            left: (width - frame * 2 - islandWidth) / 2,
            width: islandWidth,
            height: islandHeight,
            borderRadius: islandHeight / 2,
            backgroundColor: '#000000',
          }}
        />
      </View>
    </View>
  );
}

/**
 * 柔和陰影。
 *
 * react-native-web 已把 shadow* 標為 deprecated（會在 dev console 噴警告），
 * 所以 web 走 boxShadow、原生仍用 shadow*／elevation。
 */
const SOFT_SHADOW: ViewStyle = Platform.select<ViewStyle>({
  web: { boxShadow: '0 18px 44px rgba(58, 46, 79, 0.22)' } as ViewStyle,
  default: {
    shadowColor: '#3A2E4F',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
});

const styles = StyleSheet.create({
  body: {
    backgroundColor: '#111014',
    ...SOFT_SHADOW,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-between',
  },
  statusText: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
});
