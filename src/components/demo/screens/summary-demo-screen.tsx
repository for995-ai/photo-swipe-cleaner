/**
 * Summary Section 的手機畫面：把整條流程用五個很簡單的畫面走一遍。
 *
 * 自動切換由呼叫端的 setInterval 控制（reduced motion 時完全不啟動），
 * 這裡只負責依 step 畫出對應的示意內容。刻意畫得比前面幾段更簡略，
 * 因為這一段是收尾，不是再教一次功能。
 */
import { StyleSheet, Text, View } from 'react-native';

import { DemoPhotoArt } from '@/components/demo/demo-photo-art';
import { CheckIcon, PhotoIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelProgress } from '@/components/pixel/pixel-progress';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { DEMO_FLOW_STEPS, DEMO_PHOTOS, type DemoFlowStep } from '@/lib/demo-fixtures';
import { border, colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

type Props = {
  screenWidth: number;
  step: DemoFlowStep;
};

const HEADINGS: Record<DemoFlowStep, string> = {
  scope: '選擇範圍',
  swipe: '滑動整理',
  review: '待刪除確認',
  confirm: '系統確認',
  done: '完成',
};

export function SummaryDemoScreen({ screenWidth, step }: Props) {
  const pad = Math.round(screenWidth * 0.055);
  const gap = spacing.sm;
  const cell = Math.floor((screenWidth - pad * 2 - gap * 2) / 3) - border.width * 2;
  const cardSize = screenWidth - pad * 2 - border.width * 2;

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <Text
        style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        {HEADINGS[step]}
      </Text>

      {/* 流程指示：目前走到哪一步。 */}
      <View style={styles.steps}>
        {DEMO_FLOW_STEPS.map((entry) => {
          const active = entry.step === step;
          return (
            <View
              key={entry.step}
              style={[styles.stepDot, active ? styles.stepDotActive : null]}
            />
          );
        })}
      </View>

      {step === 'scope' ? (
        <View style={{ gap: spacing.sm }}>
          {['所有照片', '截圖', '最近 30 天'].map((label, index) => (
            <PixelSurface
              key={label}
              background={index === 2 ? colors.surfaceAlt : colors.surface}
              outlineColor={index === 2 ? colors.primaryText : colors.outline}
              outlineWidth={index === 2 ? border.widthThick : border.width}
              shadowOffset={index === 2 ? 4 : 0}
              style={styles.row}>
              <PhotoIcon size={iconSize.sm} fill={colors.primaryText} />
              <Text
                style={[typeStyle(typeAccent.buttonSmall, screenWidth), styles.heading]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                {label}
              </Text>
            </PixelSurface>
          ))}
        </View>
      ) : null}

      {step === 'swipe' ? (
        <>
          <PixelProgress value={148} total={184} />
          <View style={styles.stats}>
            <PixelBadge label="已保留" value={133} tone="keep" />
            <PixelBadge label="待刪除" value={15} tone="discard" />
          </View>
          <View style={styles.center}>
            <PixelSurface clip style={styles.card}>
              <DemoPhotoArt photo={DEMO_PHOTOS[1]} size={cardSize} />
            </PixelSurface>
          </View>
        </>
      ) : null}

      {step === 'review' ? (
        <>
          <View style={styles.stats}>
            <PixelBadge label="待刪除" value={9} tone="discard" />
          </View>
          <View style={[styles.grid, { gap }]}>
            {DEMO_PHOTOS.slice(0, 9).map((photo) => (
              <PixelSurface key={photo.id} clip shadowOffset={0} style={styles.cell}>
                <DemoPhotoArt photo={photo} size={cell} />
              </PixelSurface>
            ))}
          </View>
        </>
      ) : null}

      {step === 'confirm' ? (
        <View style={styles.center}>
          <PixelSurface outlineWidth={border.widthThick} outlineColor={colors.primaryText} style={styles.dialog}>
            <TrashIcon size={iconSize.lg} fill={colors.discard} />
            <Text
              style={[typeStyle(typeAccent.noticeTitle, screenWidth), styles.headingCenter]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              iPhone 會要求你確認一次
            </Text>
            <PixelBadge label="一次送出" value={45} tone="discard" />
          </PixelSurface>
        </View>
      ) : null}

      {step === 'done' ? (
        <View style={styles.center}>
          <PixelSurface outlineWidth={border.widthThick} outlineColor={colors.keepText} style={styles.dialog}>
            <CheckIcon size={iconSize.lg} fill={colors.keep} />
            <Text
              style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.headingCenter]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              已完成刪除
            </Text>
            <View style={styles.stats}>
              <PixelBadge label="成功刪除" value={45} tone="keep" />
              <PixelBadge label="系統確認" value={1} tone="neutral" />
            </View>
            <View style={styles.infoRow}>
              <ShieldIcon size={iconSize.sm} fill={colors.keep} />
              <Text
                style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                進度已保存在本機
              </Text>
            </View>
          </PixelSurface>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  heading: {
    color: colors.textPrimary,
  },
  headingCenter: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  muted: {
    color: colors.textSecondary,
  },
  steps: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stepDot: {
    backgroundColor: colors.disabledSurface,
    borderRadius: 2,
    flex: 1,
    height: 4,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.ms,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    padding: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    padding: 0,
  },
  dialog: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    width: '100%',
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
