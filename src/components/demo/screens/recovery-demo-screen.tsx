/**
 * Section 05 的手機畫面：進度保存與安全恢復。
 *
 * 刻意寫成「生活化」的說法，不把技術細節丟給一般觀看者。
 * 依規格，畫面上絕對不顯示 runId／rawValue／storage key／batchIndex／totalBatches。
 *
 * 不 import delete-journal 或 session：兩種畫面的數字都來自 DEMO_RECOVERY。
 */
import { StyleSheet, Text, View } from 'react-native';

import { CheckIcon, ShieldIcon, WarnIcon } from '@/components/icons';
import { PixelBadge } from '@/components/pixel/pixel-badge';
import { PixelButton } from '@/components/pixel/pixel-button';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSurface } from '@/components/pixel/pixel-surface';
import { DEMO_RECOVERY } from '@/lib/demo-fixtures';
import { colors, iconSize, spacing } from '@/lib/theme';
import { textScaling, typeAccent, typeStyle } from '@/lib/typography';

export type RecoveryDemoView = 'saved' | 'recovery' | 'resolved-present' | 'resolved-deleted';

type Props = {
  screenWidth: number;
  view: RecoveryDemoView;
  onConfirmStillPresent: () => void;
  onConfirmDeleted: () => void;
};

export function RecoveryDemoScreen({
  screenWidth,
  view,
  onConfirmStillPresent,
  onConfirmDeleted,
}: Props) {
  const pad = Math.round(screenWidth * 0.055);

  return (
    <View style={[styles.root, { padding: pad, gap: spacing.ms }]}>
      <Text
        style={[typeStyle(typeAccent.screenHeading, screenWidth), styles.heading]}
        maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
        整理進度
      </Text>

      {view === 'saved' ? (
        <>
          <PixelNotice
            tone="success"
            title="整理進度已保存"
            icon={<ShieldIcon size={iconSize.sm} fill={colors.keep} />}>
            關掉 App 也不會消失，下次回來接著整理就好。
          </PixelNotice>
          <View style={styles.statsColumn}>
            <View style={styles.stats}>
              <PixelBadge label="已保留" value={DEMO_RECOVERY.savedKept} tone="keep" />
              <PixelBadge label="待確認" value={DEMO_RECOVERY.savedPending} tone="warning" />
            </View>
            <View style={styles.stats}>
              <PixelBadge label="已刪除" value={DEMO_RECOVERY.savedDeleted} tone="neutral" />
            </View>
          </View>
          <View style={styles.spacer} />
          <PixelSurface background={colors.surfaceAlt} shadowOffset={0} style={styles.infoBox}>
            <Text
              style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              進度只存在這台裝置上，不會上傳。
            </Text>
          </PixelSurface>
        </>
      ) : null}

      {view === 'recovery' ? (
        <>
          <PixelNotice
            tone="warning"
            title="偵測到上次未完成的刪除紀錄"
            icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
            請先到 iPhone「照片」App 確認照片是否仍存在。
          </PixelNotice>
          <View style={styles.stats}>
            <PixelBadge label="涉及照片" value={DEMO_RECOVERY.affectedCount} tone="warning" />
          </View>
          <Text
            style={[typeStyle(typeAccent.micro, screenWidth), styles.muted]}
            maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
            App 不會自己猜結果，也不會重新刪除照片。
          </Text>
          <View style={styles.spacer} />
          <View style={{ gap: spacing.sm }}>
            <PixelButton label="我已確認照片仍存在" tone="neutral" haptics={false} onPress={onConfirmStillPresent} />
            <PixelButton label="我已確認照片已刪除" tone="discard" haptics={false} onPress={onConfirmDeleted} />
          </View>
        </>
      ) : null}

      {view === 'resolved-present' || view === 'resolved-deleted' ? (
        <View style={styles.resolvedWrap}>
          <PixelSurface style={styles.resolved}>
            <CheckIcon size={iconSize.lg} fill={colors.keep} />
            <Text
              style={[typeStyle(typeAccent.sectionTitle, screenWidth), styles.heading]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              已安全解除
            </Text>
            <Text
              style={[typeStyle(typeAccent.micro, screenWidth), styles.mutedCenter]}
              maxFontSizeMultiplier={textScaling.maxFontSizeMultiplier}>
              {view === 'resolved-present'
                ? '照片仍在相簿裡，待刪清單沒有變動，可以繼續整理。'
                : '已把這些照片記錄為刪除完成，不會再次呼叫 iPhone 刪除功能。'}
            </Text>
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
  mutedCenter: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  statsColumn: {
    gap: spacing.sm,
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  infoBox: {
    padding: spacing.ms,
  },
  resolvedWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  resolved: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
});
