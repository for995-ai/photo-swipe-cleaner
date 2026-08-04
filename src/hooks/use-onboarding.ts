import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 首次使用教學是否看過。
 * 本機只保存一個布林值 onboardingCompleted，不保存任何照片資料。
 */
const STORAGE_KEY = 'photo-swipe-cleaner/onboarding/v1';

export type OnboardingController = {
  /** null 代表還在讀取，尚不確定要不要顯示教學。 */
  completed: boolean | null;
  complete: () => void;
  /**
   * 只清除 onboardingCompleted，讓教學可以重新顯示。
   * 不會動到整理 Session（不同的 storage key）。開發期驗證用。
   */
  reset: () => void;
};

export function useOnboarding(): OnboardingController {
  const [completed, setCompleted] = useState<boolean | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive.current) {
          return;
        }
        let done = false;
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            done =
              typeof parsed === 'object' &&
              parsed !== null &&
              (parsed as { onboardingCompleted?: unknown }).onboardingCompleted === true;
          } catch {
            done = false;
          }
        }
        setCompleted(done);
      })
      .catch(() => {
        // 讀不到就當成沒看過，顯示教學總比漏掉安全提醒好。
        if (alive.current) {
          setCompleted(false);
        }
      });
  }, []);

  const complete = useCallback(() => {
    setCompleted(true);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ onboardingCompleted: true })).catch(
      () => {}
    );
  }, []);

  const reset = useCallback(() => {
    setCompleted(false);
    // 只移除教學這一把 key，整理進度存在另一把 key，完全不受影響。
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  return { completed, complete, reset };
}
