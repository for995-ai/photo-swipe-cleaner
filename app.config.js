/**
 * 動態 Expo 設定。
 *
 * 唯一的作用：只在「建置 GitHub Pages 用的 web bundle」時，把 repository
 * subpath 注入 `experiments.baseUrl`。
 *
 * 為什麼不直接寫在 app.json：
 * expo-router 的 appendBaseUrl 只用 `NODE_ENV !== 'development'` 判斷，
 * **沒有**判斷平台。所以一旦 baseUrl 進了 app.json，未來的 production native
 * build（EAS／TestFlight）也會被套上 `/photo-swipe-cleaner` 前綴 —— 那是
 * GitHub Pages 的部署細節，不該跟著 App 進到 App Store。
 *
 * 用法：
 *   npx expo export --platform web        → 無前綴（本機預覽、其他 host）
 *   GITHUB_PAGES_BUILD=1 npx expo export --platform web  → 帶 /photo-swipe-cleaner
 *   npx expo export --platform ios        → 永遠不帶前綴
 *
 * app.json 仍然是設定的單一來源；這裡只在最外層加一個條件式欄位，
 * 其餘完全沿用（含 name／slug／version／ios 權限文案／plugins／scheme）。
 */

/** GitHub Pages 是 repository site，網址帶 repo 名稱作為子路徑。 */
const GITHUB_PAGES_BASE_URL = '/photo-swipe-cleaner';

module.exports = ({ config }) => {
  // 只認明確的 '1'，避免 CI 上任何非空字串都誤觸。
  const isGitHubPagesBuild = process.env.GITHUB_PAGES_BUILD === '1';

  if (!isGitHubPagesBuild) {
    // 一般情況原封不動回傳，native build 與今天完全一致。
    return config;
  }

  return {
    ...config,
    experiments: {
      ...config.experiments,
      baseUrl: GITHUB_PAGES_BASE_URL,
    },
  };
};
