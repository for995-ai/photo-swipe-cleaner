import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { AppButton, Body, Caption, Notice, Screen, Title } from '@/components/ui';
import { useCleanup } from '@/hooks/use-cleanup';
import {
  PHOTO_PAGE_SIZE,
  describeError,
  openSystemSettingsAsync,
  pickMorePhotosAsync,
} from '@/lib/photos';
import { spacing } from '@/lib/theme';

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
            <ActivityIndicator />
            <Caption>正在確認權限狀態…</Caption>
          </View>
        ) : null}

        {access?.level === 'undetermined' ? (
          <Notice title="尚未詢問">
            按下下方按鈕後，才會出現系統的相簿權限對話框。App 啟動時不會主動詢問。
          </Notice>
        ) : null}

        {access?.level === 'full' ? (
          <Notice tone="success" title="完整存取">
            已可讀取整個相簿，會依時間由新到舊每次載入 {PHOTO_PAGE_SIZE} 張，一邊整理一邊往下讀。
          </Notice>
        ) : null}

        {access?.level === 'limited' ? (
          <Notice tone="warning" title="有限存取">
            目前只能整理你所選取的照片，看到的張數會少於整個相簿。可以按「選擇更多照片」追加，或在「設定」改為允許全部照片。
          </Notice>
        ) : null}

        {access?.level === 'denied' ? (
          <Notice tone="danger" title={access.canAskAgain ? '已拒絕' : '已拒絕或受限制'}>
            {access.canAskAgain
              ? '尚未取得相簿權限，可以再試一次。'
              : '系統不會再次詢問，請前往 iPhone 的「設定 → 隱私權與安全性 → 照片」開啟權限。若是家長控管造成的限制，需要由管理者解除。'}
          </Notice>
        ) : null}

        {error ? <Notice tone="danger" title="發生問題">{error}</Notice> : null}
        {actionError ? <Notice tone="danger" title="發生問題">{actionError}</Notice> : null}
      </View>

      <View style={styles.actions}>
        {access?.level === 'full' || access?.level === 'limited' ? (
          <AppButton label="開始瀏覽照片" onPress={() => router.push('/photos')} />
        ) : (
          <AppButton
            label={requesting ? '正在請求權限…' : '允許存取'}
            disabled={access === null || requesting || (access.level === 'denied' && !access.canAskAgain)}
            onPress={() => void request()}
          />
        )}

        {access?.level === 'limited' && Platform.OS !== 'web' ? (
          <AppButton label="選擇更多照片" variant="secondary" onPress={() => void handlePickMore()} />
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
