import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CleanupProvider } from '@/hooks/use-cleanup';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <CleanupProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}>
          {/* 關掉邊緣返回手勢，避免和照片卡片的右滑（保留）互相搶手勢。 */}
          <Stack.Screen name="photos" options={{ gestureEnabled: false }} />
        </Stack>
      </CleanupProvider>
    </SafeAreaProvider>
  );
}
