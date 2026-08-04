import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { CheckIcon, ShieldIcon, WarnIcon } from '@/components/icons';
import { PixelNotice } from '@/components/pixel/pixel-notice';
import { PixelSpinner } from '@/components/pixel/pixel-spinner';
import { AppButton, Body, Caption, Screen, Title } from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import {
  PHOTO_PAGE_SIZE,
  describeError,
  openSystemSettingsAsync,
  pickMorePhotosAsync,
} from '@/lib/photos';
import { colors, iconSize, spacing } from '@/lib/theme';

export default function PermissionScreen() {
  const router = useRouter();
  const { access: accessController } = useCleanup();
  const { access, requesting, error, refresh, request } = accessController;
  const [actionError, setActionError] = useState<string | null>(null);

  const handleOpenSettings = async () => {
    try {
      await openSystemSettingsAsync();
    } catch (cause) {
      setActionError(describeError(cause, '無法開啟系統設定，請手動前往「設定」App'));
    }
  };

  const handlePickMore = async () => {
    try {
      await pickMorePhotosAsync();
      await refresh();
    } catch (cause) {
      setActionError(describeError(cause, '無法開啟照片選擇畫面'));
    }
  };

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <Title>允許存取相簿</Title>
        <Body muted>需要相簿權限，才能顯示並整理你的照片</Body>
      </View>

      <View style={styles.states}>
        {access === null ? (
          <View style={styles.loading}>
            <PixelSpinner size={iconSize.md} />
            <Caption>正在確認權限狀態…</Caption>
          </View>
        ) : null}

        {access?.level === 'undetermined' ? (
          <PixelNotice
            title="尚未詢問"
            icon={<ShieldIcon size={iconSize.sm} fill={colors.primary} />}>
            按下下方按鈕後，才會出現系統的相簿權限對話框。App 啟動時不會主動詢問。
          </PixelNotice>
        ) : null}

        {access?.level === 'full' ? (
          <PixelNotice
            tone="success"
            title="完整存取"
            icon={<CheckIcon size={iconSize.sm} fill={colors.keep} />}>
            已可讀取整個相簿，會依時間由新到舊每次載入 {PHOTO_PAGE_SIZE} 張，一邊整理一邊往下讀。
          </PixelNotice>
        ) : null}

        {access?.level === 'limited' ? (
          <PixelNotice
            tone="warning"
            title="有限存取"
            icon={<WarnIcon size={iconSize.sm} fill={colors.warning} />}>
            目前只能整理你所選取的照片，看到的張數會少於整個相簿。可以按「選擇更多照片」追加，或在「設定」改為允許全部照片。
          </PixelNotice>
        ) : null}

        {access?.level === 'denied' ? (
          <PixelNotice
            tone="danger"
            title={access.canAskAgain ? '已拒絕' : '已拒絕或受限制'}
            icon={<ShieldIcon size={iconSize.sm} fill={colors.discard} />}>
            {access.canAskAgain
              ? '尚未取得相簿權限，可以再試一次。'
              : '系統不會再次詢問，請前往 iPhone 的「設定 → 隱私權與安全性 → 照片」開啟權限。若是家長控管造成的限制，需要由管理者解除。'}
          </PixelNotice>
        ) : null}

        {error ? (
          <PixelNotice
            tone="danger"
            title="發生問題"
            icon={<WarnIcon size={iconSize.sm} fill={colors.discard} />}>
            {error}
          </PixelNotice>
        ) : null}
        {actionError ? (
          <PixelNotice
            tone="danger"
            title="發生問題"
            icon={<WarnIcon size={iconSize.sm} fill={colors.discard} />}>
            {actionError}
          </PixelNotice>
        ) : null}
      </View>

      <View style={styles.actions}>
        {access?.level === 'full' || access?.level === 'limited' ? (
          // 授權完成後回到範圍選擇，不直接進整理頁。
          <AppButton label="選擇整理範圍" onPress={() => router.replace('/scope')} />
        ) : (
          <AppButton
            label={requesting ? '正在請求權限…' : '允許存取'}
            disabled={
              access === null || requesting || (access.level === 'denied' && !access.canAskAgain)
            }
            onPress={() => void request()}
          />
        )}

        {access?.level === 'limited' && Platform.OS !== 'web' ? (
          <AppButton
            label="選擇更多照片"
            variant="secondary"
            onPress={() => void handlePickMore()}
          />
        ) : null}

        {access?.level === 'denied' && !access.canAskAgain ? (
          <AppButton
            label="前往 iPhone 設定"
            variant="secondary"
            onPress={() => void handleOpenSettings()}
          />
        ) : null}

        <Caption>照片只在你的裝置上處理，不會上傳。</Caption>
        <AppButton label="返回首頁" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 內容由上往下排並收斂間距，避免畫面中間出現大片留白。
  screen: {
    gap: spacing.md,
    justifyContent: 'flex-start',
  },
  header: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  states: {
    gap: spacing.sm,
  },
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
});
