# 相簿滑滑整理（Photo Swipe Cleaner）

用左右滑動整理 iPhone 相簿的 React Native／Expo App。右滑保留、左滑加入待刪清單，正式刪除前可以在 Review 頁重新檢查一次。

使用者選多少張，App 就把本次選取一次送交 iPhone 系統確認；App 本身不設可見的刪除張數上限。所有照片讀取與處理都在裝置端進行，不會上傳照片。

## 目前版本

**Beta 0.5**，以 Expo Go 進行 iPhone 封閉測試。

- 尚未設定正式 bundle identifier 與 iOS build number
- 尚未建立 `eas.json`
- 尚未進行 TestFlight
- 尚未上架 App Store

各版本主題：

| 版本 | 主題 |
| --- | --- |
| Beta 0.1 | 封閉測試基礎：權限流程與照片讀取 |
| Beta 0.2 | 曾加入封閉測試期間的刪除數量安全限制；Beta 0.5 已改為單次全選交易 |
| Beta 0.3 | 照片範圍選擇與 scope 隔離 |
| Beta 0.4 | 可愛像素介面 |
| Beta 0.5 | 單次全選刪除交易與安全恢復 |

Beta 0.2 的數量限制屬於歷史版本，目前的 Beta 0.5 已經完全移除，程式中不存在任何自行分批的邏輯。

## 核心功能

### 滑動整理

- 右滑：保留這張照片
- 左滑：加入待刪清單（此時只在本機做記號，照片沒有任何變動）
- 可以復原上一個決定
- 進度以「保留／待刪除／已刪除」即時顯示

### 照片範圍

可選擇要整理哪一批照片，每個範圍各自獨立記錄進度：

- 所有照片
- 截圖
- 最近 30 天
- 指定月份
- 指定相簿

### Review 確認

- 3 欄縮圖網格
- 點縮圖可全螢幕預覽，並在預覽中前後切換
- 可以把待刪照片改回保留
- 已不在授權範圍內的項目（unavailable）可以移出待刪清單
- 正式刪除前會顯示 App 內確認視窗

### 單次刪除交易

- 使用者選多少張，就把本次選取**一次**送交 iPhone 刪除
- App 不自行切成多批
- App 不設使用者可見的刪除張數上限
- iPhone 會顯示系統刪除確認
- 在系統確認選擇不允許時，不會把任何照片記錄為已刪除
- 刪除後的照片會進入 iPhone「照片」App 的「最近刪除」，可在那裡復原

## 刪除安全架構

一次刪除的實際順序：

1. Review 取得全部**已解析**的待刪照片 ID
2. 穩定去重（保留第一次出現的順序，不修改呼叫端資料）
3. 寫入 `prepared` Delete Journal
4. 全部 ID 一次送入 PhotoKit
5. 成功後寫入 `photo-deleted` Journal
6. Session 一次記錄全部成功的 ID
7. 清除 Journal
8. Review 只把 `successfulIds` 從快取移除，並重讀相簿分頁

邊界規則：

- `deleteAssetsAsync` 只存在於 `src/lib/delete-service.ts`，其他檔案都不直接接觸 PhotoKit
- Review 不直接呼叫 PhotoKit，也不直接修改 Session 的刪除結果
- 交易執行器 `src/lib/delete-runner.ts` 不認識 React、Expo 或 PhotoKit，外部行為全部由呼叫端注入
- 照片一旦被 iPhone 回報刪除，即使之後的 Journal 或 Session 儲存失敗，也不會假裝照片還在
- 恢復流程不會再次呼叫 PhotoKit

關鍵檔案：

- `src/lib/delete-service.ts`：唯一呼叫 PhotoKit 刪除的地方
- `src/lib/delete-runner.ts`：單次交易的安全流程
- `src/lib/delete-journal.ts`：Delete Journal v1 的讀寫與狀態轉換
- `src/hooks/use-photo-deletion.ts`：把上述模組接上真實服務與 AppState

## 異常中斷與恢復

刪除過程若被強制中斷（當掉、被系統結束、電量耗盡），下次開啟 App 會依 Delete Journal 判斷狀態。App 只會自動處理**已經確定刪除成功**的情況，其餘一律交給使用者確認。

### photo-deleted

PhotoKit 已回報成功，只是進度還沒寫完。App 重開後只補記 Session 並清除紀錄，**不會再次刪除照片**。

### prepared

紀錄已建立，但 App 無法確認系統刪除的結果。此時會請使用者先到 iPhone「照片」App 檢查，再選擇「照片仍存在」或「照片已刪除」。App 不會自行猜測。

### uncertain

刪除過程發生無法判定的錯誤。同樣由使用者確認實際狀態後才更新進度，App 不會自行猜測，也不會重新刪除。

### corrupt

安全紀錄本身損壞而無法解讀。只有在使用者明確確認後，才會精確清除「與當下完全相同的那一筆」損壞紀錄；如果紀錄在期間變動過就不清除。這個操作不會刪除任何照片。

恢復畫面只顯示涉及的照片張數，不會顯示內部識別碼或原始儲存內容。

## 資料與隱私

目前程式的實際邊界：

- 照片只在裝置端讀取與處理
- 不上傳照片
- 不使用遠端伺服器
- 不使用 Analytics 或 Tracking SDK
- 不使用廣告 SDK
- 不使用帳號系統
- 不使用 AI 分析照片內容
- 不修改照片內容，也不會寫入新照片或建立相簿
- 刪除必須同時經過 App 內確認與 iPhone 系統確認

能讀取哪些照片，完全由使用者在 iOS 設定中的相簿權限決定，可隨時改為有限存取或關閉。

## 照片讀取

- 使用 Expo Media Library 分頁讀取
- 每頁 metadata 數量為 60（`PHOTO_PAGE_SIZE`）
- 接近目前頁尾時（`PREFETCH_THRESHOLD`）預先載入下一頁
- 不會一次把整個相簿載入記憶體
- 支援大型相簿的分頁瀏覽與整理

尚未針對所有相簿規模做過效能量測，超大相簿的表現仍需更多實機測試。

## 整理進度

- 使用 AsyncStorage 保存整理進度
- Session schema 目前為 **v5**，可讀回 v1～v4 的舊資料
- 保存內容：`keptIds`、`discardedIds`、`deletedIds`、`history`、`sessionTotalEstimate`、`scope`
- 每個照片範圍使用獨立的 Session，彼此完全隔離
- 切換範圍時不會把一個範圍的進度寫進另一個範圍
- 儲存採序列化 queue，快速連續操作不會互相覆蓋
- 提交刪除結果時可帶 `expectedScopeKey`；範圍不符就完全不動任何資料並回報失敗

## 技術架構

- Expo SDK 54
- React Native 0.81.5
- React 19.1.0
- Expo Router 6
- TypeScript strict mode
- Expo Media Library
- AsyncStorage

刻意停留在 SDK 54：SDK 57 過渡期間，App Store 版的 Expo Go 需搭配 SDK 54 才能在實體 iPhone 開啟。

## 主要專案結構

```
src/
  app/                          Expo Router 路由
    _layout.tsx                 Stack + SafeAreaProvider
    index.tsx                   首頁
    permission.tsx              相簿權限流程
    scope.tsx                   照片範圍選擇
    photos.tsx                  滑動整理頁
    review.tsx                  待刪確認、刪除與恢復 UI
    about.tsx                   關於與隱私
    feedback.tsx                回報問題
  hooks/
    use-cleanup.tsx             整理頁的組合入口（權限、分頁、Session、範圍）
    use-cleanup-session.ts      Session 狀態、序列化保存、刪除結果提交
    use-photo-deletion.ts       單次刪除交易與 Journal 恢復
    use-discarded-resolver.ts   待刪 ID 的三態解析（可檢視／解析中／無法取得）
    use-photo-library.ts        權限狀態與照片分頁讀取
    use-scope.ts                範圍選擇與保存
    use-album-availability.ts   指定相簿是否仍可用
    use-onboarding.ts           首次使用教學
  lib/
    delete-service.ts           唯一呼叫 PhotoKit 刪除的模組
    delete-runner.ts            單次刪除交易的安全流程
    delete-journal.ts           Delete Journal v1
    session.ts                  Session schema v5 與純函式
    scope.ts                    照片範圍定義與 scope key
    photos.ts                   相簿權限與照片讀取的唯一入口
    theme.ts / typography.ts    顏色、間距、字級縮放
    app-info.ts                 App 名稱與版本標示
    debug-flags.ts              開發期旗標
  components/
    ui.tsx                      Screen／文字／按鈕／提示卡
    swipe-card.tsx              滑動卡片
    onboarding-modal.tsx        使用教學
    icons.tsx                   像素風圖示
    pixel/                      像素 UI 元件（surface／button／badge／notice／spinner／progress）
```

## 本機執行

以下為目前開發機（Windows PowerShell）的操作路徑：

```powershell
cd "D:\Projects\photo-swipe-cleaner"
npm ci
npx expo start --lan --clear
```

從 GitHub clone 的話，把路徑換成自己的 clone 位置即可。

在 iPhone 上測試：

1. iPhone 安裝 App Store 的 **Expo Go**（本專案為 SDK 54，iOS 需 15.1+）
2. iPhone 與電腦連到同一個網路
3. 執行上面的 `npx expo start --lan --clear`，終端機會顯示 QR Code
4. 用 iPhone 相機掃描 QR Code，在 Expo Go 中開啟
5. 首頁按「開始整理」→ 選擇照片範圍 → 權限頁按「允許存取」，系統才會跳出相簿權限對話框

> 在 Expo Go 中執行時，iOS 讀取的是 Expo Go 自己的 `Info.plist`，因此權限與刪除的系統視窗會顯示 **Expo Go** 的名稱與說明文字。這是目前測試環境的正常現象，不代表操作對象有誤。要看到本專案的文字需另外建置 development build 或正式版。

## 開發檢查

```bash
npx tsc --noEmit
```

```bash
npx expo-doctor
```

```bash
npx expo export --platform ios
```

- `expo export` 產生的 `dist/` 不提交，`.gitignore` 已忽略
- 提交前確認 working tree clean
- 專案目前沒有永久測試套件；刪除流程的安全驗證使用專案外的一次性 harness，驗證完成後刪除

## Beta 0.5 真機驗收

以 Expo Go 在實體 iPhone 確認：

| 情境 | 結果 |
| --- | --- |
| 20 張 | 一次送出、iPhone 系統確認 1 次、一次完成 |
| 21 張 | 一次送出、iPhone 系統確認 1 次、一次完成 |
| 45 張 | 一次送出、iPhone 系統確認 1 次、一次完成 |
| 系統確認選「不允許」 | 成功刪除 0 張，照片仍留在待刪清單 |

Beta 0.5 之前曾嘗試由 App 自行把待刪照片切成多批依序送出。實機測試發現 iOS 的系統確認視窗會讓 App 進入 `inactive`，導致「下一批可以開始了嗎」的判斷永遠不成立，21 張只會完成前一批、45 張需要使用者手動操作三次。因此改為單次交易：一次送出全部選取，iPhone 只要求一次確認。

尚未在真機驗收的項目包括更大的張數（例如 500 張）與其他 iPhone 型號。

## 已知限制

- 目前僅以 Expo Go 測試，尚無 development build
- 權限與刪除的系統視窗會顯示 Expo Go 的名稱
- 尚未設定 iOS bundle identifier
- 尚未設定 iOS build number
- 尚未建立 `eas.json`
- 尚未進行 TestFlight
- 大量照片可能需要較長處理時間，處理期間請保持 App 開啟
- iOS swipe-back 與導覽手勢在刪除／恢復鎖定期間仍需更多實機測試
- `prepared`／`uncertain`／`corrupt` 三種恢復狀態需要 fixture 才能穩定重現，目前依賴一次性 harness 驗證

## 版本管理

- 正式分支：`main`
- Beta 0.5 開發分支：`beta/0.5`
- 目前**尚未**建立 `beta-v0.5.0` tag

專案裡有兩個彼此獨立的版本欄位，用途不同：

- `APP_VERSION_LABEL`（`src/lib/app-info.ts`）目前為 `Beta 0.5`，是**封閉測試的 UI 標示**。首頁、關於頁與回報問題頁都從這個共用常數取值，各頁不自行寫死版本字串。
- `app.json` 的 `expo.version` 目前仍為 `1.0.0`，屬於 Expo App 設定。尚未建立正式發布版本策略，也尚未設定 `ios.buildNumber` 與 `ios.bundleIdentifier`。

已建立的 tag：

- `beta-v0.1.0`
- `beta-v0.2.0`
- `beta-v0.3.0`
- `beta-v0.4.0`
