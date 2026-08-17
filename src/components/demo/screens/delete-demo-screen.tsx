/**
 * Section 04 的手機畫面：模擬單次全選刪除交易。
 *
 * 這是整個 Demo 最需要講清楚「這只是展示」的一段。
 *
 * 絕對安全：本檔不 import delete-service／delete-runner／use-photo-deletion，
 * 也不呼叫任何 PhotoKit API。「開始刪除」只會把 Demo 的 stage 往前推一格，
 * 系統確認視窗是純視覺 mockup，並明確標示「展示模式」。
 */
import { StyleSheet, Text, View } from 'react-native';

import { CheckIcon, WarnIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { DEMO_DELETE_RESULT } from '@/lib/demo-fixtures';
import { border, colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

/**
 * Demo 的五個階段。
 * idle → app-confirm →（系統確認 mockup）system-confirm → completed / cancelled
 */
export type DeleteDemoStage = 'idle' | 'app-confirm' | 'system-confirm' | 'completed' | 'cancelled';

type Props = {
  screenWidth: number;
  stage: DeleteDemoStage;
  onRequestDelete: () => void;
  onCancelAppConfirm: () => void;
  onStartDelete: () => void;
  onSystemCancel: () => void;
  onSystemConfirm: () => void;
  onReset: () => void;
};

export function DeleteDemoScreen({
  screenWidth,
  stage,
  onRequestDelete,
  onCancelAppConfirm,
  onStartDelete,
  onSystemCancel,
  onSystemConfirm,
  onReset,
}: Props) {
  const pad = Math.round(screenWidth * 0.055);
  const pending = DEMO_DELETE_RESULT.pendingCount;

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <Text
        style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        待刪除確認
      </Text>

      {stage === 'idle' || stage === 'app-confirm' || stage === 'system-confirm' ? (
        <>
          <View style={styles.stats}>
            <PixelBadge label="待刪除" value={pending} tone="discard" />
            <PixelBadge label="已保留" value={133} tone="keep" />
          </View>

          <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.zone}>
            <PixelBadge label="安全刪除模式" tone="discard" />
            <Text
              style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              你選擇的照片會一次送出刪除。iPhone 會要求你確認一次。
            </Text>
          </PixelSurface>

          <View style={styles.spacer} />

          <PixelButton
            label={`刪除 ${pending} 張照片`}
            tone="discard"
            haptics={false}
            disabled={stage !== 'idle'}
            onPress={onRequestDelete}
          />
        </>
      ) : null}

      {/* 成功摘要 */}
      {stage === 'completed' ? (
        <View style={styles.summaryWrap}>
          <PixelSurface outlineWidth={border.widthThick} outlineColor={colors.keepText} style={styles.summary}>
            <CheckIcon size={iconSize.lg} fill={colors.keep} />
            <Text
              style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.heading]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              已完成刪除
            </Text>
            <View style={styles.stats}>
              <PixelBadge label="成功刪除" value={DEMO_DELETE_RESULT.successfulCount} tone="keep" />
              <PixelBadge label="系統確認" value={DEMO_DELETE_RESULT.systemConfirmationCount} tone="neutral" />
            </View>
            <View style={styles.stats}>
              <PixelBadge label="剩餘待刪" value={DEMO_DELETE_RESULT.remainingCount} tone="discard" />
            </View>
            <Text
              style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              照片會移到 iPhone「照片」App 的「最近刪除」。
            </Text>
          </PixelSurface>
          <PixelButton label="重新播放這段 Demo" tone="plain" compact haptics={false} onPress={onReset} />
        </View>
      ) : null}

      {/* 取消摘要 */}
      {stage === 'cancelled' ? (
        <View style={styles.summaryWrap}>
          <PixelNotice
            tone="warning"
            title="已取消刪除"
            icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
            照片沒有任何變更。
          </PixelNotice>
          <View style={styles.stats}>
            <PixelBadge label="成功刪除" value={0} tone="keep" />
            <PixelBadge label="仍待刪除" value={pending} tone="discard" />
          </View>
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            你選的照片仍留在待刪清單裡。App 不會自動重試。
          </Text>
          <PixelButton label="重新播放這段 Demo" tone="plain" compact haptics={false} onPress={onReset} />
        </View>
      ) : null}

      {/* App 內確認視窗：疊在畫面上方，文案與正式版一致。 */}
      {stage === 'app-confirm' ? (
        <View style={styles.overlay}>
          <PixelSurface style={styles.dialog}>
            <Text
              style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.heading]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              確認刪除照片？
            </Text>
            <Text
              style={[typeStyle(typeAccent.noticeBody, screenWidth), styles.muted]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {`準備一次刪除 ${pending} 張照片。iPhone 會要求你確認一次。`}
            </Text>
            <View style={styles.dialogButtons}>
              <View style={styles.dialogSlot}>
                <PixelButton label="取消" tone="neutral" haptics={false} onPress={onCancelAppConfirm} />
              </View>
              <View style={styles.dialogSlot}>
                <PixelButton label="開始刪除" tone="discard" haptics={false} onPress={onStartDelete} />
              </View>
            </View>
          </PixelSurface>
        </View>
      ) : null}

      {/* iOS 系統確認的「展示用」模擬，明確標示不是真的。 */}
      {stage === 'system-confirm' ? (
        <View style={styles.overlay}>
          <PixelSurface outlineWidth={border.widthThick} outlineColor={colors.primaryText} style={styles.dialog}>
            <View style={styles.demoTag}>
              <View style={styles.demoDot} />
              <Text
                style={[typeStyle(typeAccent.badgeLabel, screenWidth), styles.demoTagText]}
                maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
                展示模式
              </Text>
            </View>
            <Text
              style={[typeStyle(typeAccent.noticeTitle, screenWidth), styles.heading]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              實際 iPhone 會在這裡顯示系統刪除確認
            </Text>
            <Text
              style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              這個 Demo 不會刪除任何照片。
            </Text>
            <View style={styles.dialogButtons}>
              <View style={styles.dialogSlot}>
                <PixelButton label="模擬取消" tone="neutral" haptics={false} onPress={onSystemCancel} />
              </View>
              <View style={styles.dialogSlot}>
                <PixelButton label="模擬確認" tone="primary" haptics={false} onPress={onSystemConfirm} />
              </View>
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
  muted: {
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  zone: {
    gap: spacing.sm,
    padding: spacing.ms,
  },
  spacer: {
    flex: 1,
  },
  summaryWrap: {
    flex: 1,
    gap: spacing.ms,
    justifyContent: 'center',
  },
  summary: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: colors.overlayScrim,
    justifyContent: 'center',
    padding: spacing.md,
  },
  dialog: {
    gap: spacing.sm,
    padding: spacing.md,
    width: '100%',
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  dialogSlot: {
    flex: 1,
  },
  demoTag: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.primaryText,
    borderRadius: 4,
    borderWidth: border.width,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  demoDot: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  demoTagText: {
    color: colors.primaryText,
    letterSpacing: 0.6,
  },
});
