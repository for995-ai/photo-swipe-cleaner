# 相簿滑滑整理（Photo Swipe Cleaner）

用滑動整理 iPhone 相簿的 App。左滑加入待刪除、右滑保留，可復原；真正刪除前會再次確認。
照片只在裝置本機處理，不會上傳。

## 目前進度：第一階段

本階段只完成「專案初始化、權限與最近照片瀏覽」。

已完成：

- Expo SDK 54 + React Native 0.81 + TypeScript + Expo Router
  （**刻意停留在 SDK 54**：SDK 57 過渡期間，App Store 版的 Expo Go 需搭配 SDK 54 才能在實體 iPhone 開啟）
- 相簿權限流程（尚未詢問／完整存取／有限存取／拒絕或受限制）
- 授權後讀取最近 30 張照片（排除影片、依建立時間由新到舊）
- 照片瀏覽測試頁：單張顯示、進度、日期、上一張／下一張

**尚未實作（刻意保留給後續階段）**：左右滑動手勢、待刪除清單、狀態保存、任何刪除 API。
程式碼中不存在任何刪除照片的 API 呼叫。

## 開發

```bash
npm run start
```

```bash
npm run typecheck
```

## 在 iPhone 上測試

1. iPhone 安裝 App Store 的 **Expo Go**（本專案為 SDK 54，iOS 需 15.1+）。
2. 電腦與 iPhone 連到**同一個 Wi-Fi**。
3. 電腦執行 `npm run start`，終端機會顯示 QR Code。
4. 用 iPhone 相機掃描 QR Code，開啟 Expo Go。
5. 首頁按「開始整理」→ 權限頁按「允許存取」→ 系統才會跳出相簿權限對話框。

> **Expo Go 的權限文字**：`app.json` 已設定繁體中文的相簿權限說明
> （`NSPhotoLibraryUsageDescription`），但在 Expo Go 中執行時，iOS 讀取的是
> Expo Go 自己的 `Info.plist`，因此系統對話框會顯示 **Expo Go 的權限說明文字**。
> 要看到本專案的文字，需要另外建置 development build 或正式版。

## 專案結構

```
src/
  app/                        Expo Router 路由
    _layout.tsx               Stack + SafeAreaProvider
    index.tsx                 首頁
    permission.tsx            相簿權限頁
    photos.tsx                照片瀏覽測試頁
  components/ui.tsx           共用的 Screen／文字／按鈕／提示卡
  hooks/use-photo-library.ts  權限狀態與照片讀取
  lib/photos.ts               相簿權限與照片讀取的唯一入口
  lib/theme.ts                顏色、間距、字級縮放
```
