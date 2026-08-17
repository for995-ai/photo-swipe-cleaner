/**
 * 抽象的假「照片」。
 *
 * 用疊層 View 畫出十二種可辨識的構圖，完全不使用任何影像檔：
 * - 沒有版權風險
 * - 不含任何私人照片
 * - web 與 native 表現一致（只用 backgroundColor／borderRadius／transform）
 *
 * 目的只是讓 Demo 卡片看起來有內容、且每張可以分辨，不是要畫得像真照片。
 */
import { StyleSheet, View } from 'react-native';

import type { DemoPhoto, DemoPhotoPattern } from '@/lib/demo-fixtures';

type Props = {
  photo: DemoPhoto;
  /** 正方形邊長；圓角由呼叫端的容器負責裁切。 */
  size: number;
};

/** 每種構圖都收到「由深到淺」的三個色階與畫布邊長。 */
type Layers = (colors: readonly [string, string, string], size: number) => React.ReactNode;

const PATTERNS: Record<DemoPhotoPattern, Layers> = {
  // 上半天空漸層感 + 低處一顆太陽 + 海平線
  sunset: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={[abs, { height: s * 0.62, backgroundColor: mid }]} />
      <View
        style={{
          position: 'absolute',
          left: s * 0.5 - s * 0.15,
          top: s * 0.34,
          width: s * 0.3,
          height: s * 0.3,
          borderRadius: s * 0.15,
          backgroundColor: dark,
        }}
      />
      <View style={{ position: 'absolute', left: 0, right: 0, top: s * 0.62, height: s * 0.38, backgroundColor: dark, opacity: 0.85 }} />
    </>
  ),
  // 淡藍底 + 三塊雲
  sky: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: mid }]} />
      <View style={{ position: 'absolute', left: s * 0.1, top: s * 0.22, width: s * 0.42, height: s * 0.14, borderRadius: s * 0.07, backgroundColor: light }} />
      <View style={{ position: 'absolute', left: s * 0.46, top: s * 0.44, width: s * 0.44, height: s * 0.12, borderRadius: s * 0.06, backgroundColor: light }} />
      <View style={{ position: 'absolute', left: s * 0.18, top: s * 0.66, width: s * 0.3, height: s * 0.1, borderRadius: s * 0.05, backgroundColor: light, opacity: 0.8 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.12, backgroundColor: dark, opacity: 0.35 }} />
    </>
  ),
  // 俯視咖啡：外圈杯 + 內圈液面
  coffee: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: s * 0.16, top: s * 0.16, width: s * 0.68, height: s * 0.68, borderRadius: s * 0.34, backgroundColor: mid }} />
      <View style={{ position: 'absolute', left: s * 0.26, top: s * 0.26, width: s * 0.48, height: s * 0.48, borderRadius: s * 0.24, backgroundColor: dark }} />
      <View style={{ position: 'absolute', left: s * 0.4, top: s * 0.38, width: s * 0.2, height: s * 0.08, borderRadius: s * 0.04, backgroundColor: mid, opacity: 0.6 }} />
    </>
  ),
  // 高低錯落的大樓剪影
  city: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      {[0.08, 0.28, 0.46, 0.66, 0.84].map((left, i) => {
        const heights = [0.42, 0.62, 0.34, 0.72, 0.5];
        const h = s * heights[i];
        return (
          <View
            key={left}
            style={{
              position: 'absolute',
              left: s * left,
              bottom: 0,
              width: s * 0.14,
              height: h,
              backgroundColor: i % 2 === 0 ? dark : mid,
            }}
          />
        );
      })}
    </>
  ),
  // 兩座三角山（用旋轉方塊模擬）+ 天空
  mountains: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: s * 0.02, bottom: -s * 0.18, width: s * 0.52, height: s * 0.52, backgroundColor: mid, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', right: -s * 0.04, bottom: -s * 0.24, width: s * 0.6, height: s * 0.6, backgroundColor: dark, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.14, backgroundColor: dark }} />
    </>
  ),
  // 桌面俯視：一台筆電 + 一本筆記
  desk: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: s * 0.16, top: s * 0.22, width: s * 0.52, height: s * 0.36, borderRadius: s * 0.03, backgroundColor: dark }} />
      <View style={{ position: 'absolute', left: s * 0.22, top: s * 0.28, width: s * 0.4, height: s * 0.24, backgroundColor: mid }} />
      <View style={{ position: 'absolute', left: s * 0.6, top: s * 0.62, width: s * 0.28, height: s * 0.2, borderRadius: s * 0.02, backgroundColor: mid }} />
    </>
  ),
  // 沙灘：沙 + 海 + 兩個腳印
  beach: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: mid }]} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: s * 0.34, backgroundColor: dark, opacity: 0.7 }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: s * 0.34, height: s * 0.06, backgroundColor: light }} />
      <View style={{ position: 'absolute', left: s * 0.3, top: s * 0.56, width: s * 0.1, height: s * 0.16, borderRadius: s * 0.05, backgroundColor: dark, opacity: 0.45 }} />
      <View style={{ position: 'absolute', left: s * 0.52, top: s * 0.68, width: s * 0.1, height: s * 0.16, borderRadius: s * 0.05, backgroundColor: dark, opacity: 0.45 }} />
    </>
  ),
  // 一朵花：中心 + 四片花瓣
  flowers: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      {[
        { left: 0.5, top: 0.2 },
        { left: 0.5, top: 0.5 },
        { left: 0.26, top: 0.35 },
        { left: 0.74, top: 0.35 },
      ].map((p) => (
        <View
          key={`${p.left}-${p.top}`}
          style={{
            position: 'absolute',
            left: s * p.left - s * 0.15,
            top: s * p.top - s * 0.15,
            width: s * 0.3,
            height: s * 0.3,
            borderRadius: s * 0.15,
            backgroundColor: mid,
          }}
        />
      ))}
      <View style={{ position: 'absolute', left: s * 0.5 - s * 0.1, top: s * 0.35 - s * 0.1, width: s * 0.2, height: s * 0.2, borderRadius: s * 0.1, backgroundColor: dark }} />
      <View style={{ position: 'absolute', left: s * 0.48, top: s * 0.6, width: s * 0.04, height: s * 0.3, backgroundColor: dark, opacity: 0.6 }} />
    </>
  ),
  // 夜景：深底 + 一顆月亮 + 幾點星
  night: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: dark }]} />
      <View style={{ position: 'absolute', right: s * 0.16, top: s * 0.14, width: s * 0.22, height: s * 0.22, borderRadius: s * 0.11, backgroundColor: light }} />
      {[
        { left: 0.16, top: 0.2 },
        { left: 0.3, top: 0.36 },
        { left: 0.2, top: 0.52 },
        { left: 0.62, top: 0.5 },
      ].map((p) => (
        <View key={`${p.left}-${p.top}`} style={{ position: 'absolute', left: s * p.left, top: s * p.top, width: s * 0.05, height: s * 0.05, borderRadius: s * 0.025, backgroundColor: light, opacity: 0.85 }} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: s * 0.24, backgroundColor: mid, opacity: 0.75 }} />
    </>
  ),
  // 像 UI 截圖：標題列 + 幾條清單
  screenshot: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: s * 0.18, backgroundColor: dark }} />
      {[0.28, 0.44, 0.6, 0.76].map((top, i) => (
        <View key={top} style={{ position: 'absolute', left: s * 0.12, top: s * top, width: s * (i % 2 === 0 ? 0.68 : 0.5), height: s * 0.07, borderRadius: s * 0.02, backgroundColor: mid }} />
      ))}
    </>
  ),
  // 人像：肩線 + 頭
  portrait: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: s * 0.5 - s * 0.19, top: s * 0.16, width: s * 0.38, height: s * 0.38, borderRadius: s * 0.19, backgroundColor: mid }} />
      <View style={{ position: 'absolute', left: s * 0.5 - s * 0.34, top: s * 0.6, width: s * 0.68, height: s * 0.5, borderTopLeftRadius: s * 0.3, borderTopRightRadius: s * 0.3, backgroundColor: dark }} />
    </>
  ),
  // 早餐俯視：盤子 + 兩塊食物
  food: ([dark, mid, light], s) => (
    <>
      <View style={[abs, { backgroundColor: light }]} />
      <View style={{ position: 'absolute', left: s * 0.12, top: s * 0.12, width: s * 0.76, height: s * 0.76, borderRadius: s * 0.38, backgroundColor: mid, opacity: 0.7 }} />
      <View style={{ position: 'absolute', left: s * 0.26, top: s * 0.3, width: s * 0.28, height: s * 0.28, borderRadius: s * 0.06, backgroundColor: dark }} />
      <View style={{ position: 'absolute', left: s * 0.54, top: s * 0.46, width: s * 0.22, height: s * 0.22, borderRadius: s * 0.11, backgroundColor: dark, opacity: 0.75 }} />
    </>
  ),
};

const abs = StyleSheet.absoluteFillObject;

export function DemoPhotoArt({ photo, size }: Props) {
  const draw = PATTERNS[photo.pattern];
  return (
    <View
      // 純裝飾：VoiceOver 不需要逐一朗讀色塊，卡片自己有 accessibilityLabel。
      accessible={false}
      style={{ width: size, height: size, overflow: 'hidden', backgroundColor: photo.palette[2] }}>
      {draw(photo.palette, size)}
    </View>
  );
}
