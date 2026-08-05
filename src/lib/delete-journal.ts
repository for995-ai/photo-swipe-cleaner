/**
 * 刪除安全紀錄（delete journal）v1。
 *
 * ## 為什麼需要它
 *
 * PhotoKit 的刪除與 AsyncStorage 的保存是兩個不同的系統，**不可能**組成真正的
 * 跨系統原子交易。這個檔案的目的不是消滅風險，而是把危險時間窗縮小到可辨識、
 * 並且在重開 App 後能判斷「上一輪停在哪一步」。
 *
 * 未來（階段 D 之後）的正確流程會是：
 *
 * 1. 寫入 phase = `prepared` 的 journal
 * 2. 呼叫單批 `deletePhotoAssetsAsync`
 * 3. iPhone 回報成功 → 把 journal 轉成 `photo-deleted`
 * 4. 呼叫 `commitDeletedBatch`
 * 5. Session 保存成功後才清除 journal
 *
 * 若 App 在步驟 3 與 5 之間被終止：重開後讀到 `photo-deleted`，就知道照片已經
 * 真的被刪掉、只是 Session 還沒記上，於是可以安全地重新 `commitDeletedBatch`，
 * **不需要**再碰 PhotoKit。
 *
 * ## 仍然無法消除的時間窗（誠實記錄）
 *
 * 有一個瞬間是這個設計無法覆蓋的：
 *
 * - `deletePhotoAssetsAsync` 已經成功（照片真的進了「最近刪除」）
 * - 但 journal 還沒從 `prepared` 更新成 `photo-deleted`
 * - App 恰好在這一瞬間被系統強制終止
 *
 * 重開後只會看到 `prepared`，而 `prepared` 的語意是**結果無法確認**：
 * 照片可能刪掉了，也可能沒有。因此此時：
 *
 * - 不得自動重新呼叫 PhotoKit 刪除（可能刪到不該刪的東西）
 * - 不得自動把 batchIds 加進 deletedIds（可能謊報刪除成功）
 *
 * 只能交給使用者回到確認頁重新檢查。這個窗口比「完全沒有 journal」小得多
 * （從「整批刪除 + Session 保存」縮到「一次 setItem」），但不是零。
 *
 * ## 邊界
 *
 * - 本檔只做型別、純轉換與 AsyncStorage 讀寫，不含任何 React、UI 或刪除 API。
 * - 使用獨立的 storage key namespace，完全不碰 Session v5 的 key 或 payload。
 * - 不對 batchIds 的長度設任何上限：使用者選多少張就記錄多少張。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DELETE_JOURNAL_VERSION = 1;

/** 獨立 namespace。與 Session 的 `photo-swipe-cleaner/session/v5/` 完全分開。 */
export const DELETE_JOURNAL_KEY_PREFIX = 'photo-swipe-cleaner/delete-run/v1/';

/** 保存失敗：呼叫端應該據此中止這次刪除。 */
export const DELETE_JOURNAL_SAVE_FAILED_MESSAGE = '無法儲存刪除安全紀錄，已停止後續刪除。';
export const DELETE_JOURNAL_LOAD_FAILED_MESSAGE = '無法讀取刪除安全紀錄，請稍後再試一次。';
export const DELETE_JOURNAL_CLEAR_FAILED_MESSAGE = '無法清除刪除安全紀錄，請稍後再試一次。';
/** 損壞紀錄的使用者可見訊息。技術細節一律放進 cause，不放進 message。 */
export const DELETE_JOURNAL_CORRUPT_MESSAGE =
  '刪除安全紀錄已損壞，請回到確認頁重新檢查待刪除清單。';

/**
 * 刪除紀錄的階段。
 *
 * 重開 App 讀到各個 phase 時的恢復語意（本輪只定義語意，不實作恢復 UI）：
 *
 * - `prepared`：**結果無法確認**。已保存刪除意圖，但沒能安全確認 PhotoKit 的結果。
 *   不得自動重送刪除，也不得自動提交 deletedIds。後續 UI 必須提示使用者回到
 *   確認頁自己檢查。
 *
 * - `photo-deleted`：`deletePhotoAssetsAsync` 已回報 deleted，且這個 phase 已經
 *   成功寫進本機。**不得**再次呼叫 PhotoKit。若 Session 還沒提交，後續階段應該
 *   重新 `commitDeletedBatch(batchIds)`，保存成功後才清除 journal。
 *
 * - `uncertain`：刪除 API 回報了「非取消」的錯誤，或執行結果無法可靠確認。
 *   不得自動重試，也不得自動加入 deletedIds。後續 UI 顯示失敗／不確定狀態，
 *   由使用者主動處理。
 *
 * 另外，讀到 `none`（沒有紀錄）代表正常：沒有未完成的刪除交易。
 */
export type DeleteJournalPhase = 'prepared' | 'photo-deleted' | 'uncertain';

/**
 * 一筆刪除紀錄。一次只會有一筆「進行中的刪除交易」，所以每個範圍只存一筆。
 *
 * `batchIndex`／`batchNumber`／`totalBatches` 是 v1 留下來的欄位名稱，保留是為了
 * 讓舊紀錄仍然讀得回來。Beta 0.5 起 App 只做單次交易，寫入時固定是 0 / 1 / 1，
 * UI 也不再顯示「第幾批」。
 */
export type DeleteJournalEntryV1 = {
  version: 1;
  /** 一次刪除交易的識別碼；用來防止舊流程清掉新流程的紀錄。 */
  runId: string;
  /** 這筆紀錄屬於哪個整理範圍。必須與 storage key 相符。 */
  scopeKey: string;
  phase: DeleteJournalPhase;
  /** 0-based。 */
  batchIndex: number;
  /** 1-based，恆等於 batchIndex + 1。 */
  batchNumber: number;
  totalBatches: number;
  /** 這一批的照片 ID；至少一筆、無重複、全為有效非空字串。 */
  batchIds: string[];
  createdAt: number;
  updatedAt: number;
  /** 使用者可見的補充說明；`photo-deleted` 通常為 null。 */
  message: string | null;
};

export type DeleteJournalWriteResult =
  | { ok: true }
  | { ok: false; message: string; cause?: unknown };

/**
 * 讀取結果。
 *
 * `corrupt` 與 `failed` 刻意分開：
 * - `corrupt`：**讀到了**資料，但 JSON 或 schema 無效 → 資料本身有問題
 * - `failed`：AsyncStorage 的 getItem 自己失敗 → 儲存層有問題，資料可能還好好的
 *
 * 這個區別很重要：`failed` 不可以被當成「沒有未完成交易」，否則會漏掉一筆
 * 真正存在的 photo-deleted 紀錄。
 */
export type DeleteJournalLoadResult =
  | { status: 'none' }
  | { status: 'loaded'; entry: DeleteJournalEntryV1 }
  | {
      status: 'corrupt';
      message: string;
      /**
       * AsyncStorage 這一次實際讀到的原始字串。
       *
       * 存在的唯一理由是「精確清除」：使用者確認要丟掉損壞紀錄時，必須能證明
       * 要刪的就是他當時看到的那一筆。只憑 key 就 removeItem 有可能刪掉在這
       * 期間才寫進去的、完全不同的紀錄。
       *
       * 這是內部資料，**不得**放進任何使用者可見的訊息或公開狀態。
       * `failed` 沒有這個欄位——那種情況我們根本沒讀到內容。
       */
      rawValue: string;
      cause?: unknown;
    }
  | { status: 'failed'; message: string; cause?: unknown };

export type DeleteJournalClearResult =
  | { ok: true; cleared: boolean }
  | { ok: false; cleared: false; message: string; cause?: unknown };

export type DeleteJournalValidation =
  | { valid: true; entry: DeleteJournalEntryV1 }
  | { valid: false; message: string };

function isNonEmptyString(value: unknown): value is string {
  // 只有空白的字串也算無效，但這裡不 trim、不改寫任何值。
  return typeof value === 'string' && value.trim().length > 0;
}

function isPhase(value: unknown): value is DeleteJournalPhase {
  return value === 'prepared' || value === 'photo-deleted' || value === 'uncertain';
}

/**
 * 產生某個整理範圍的 journal storage key。
 *
 * 刻意用拋錯而不是回傳 fallback：任何「共用的預設 key」都會讓兩個範圍的
 * 刪除紀錄互相覆蓋，那比直接失敗危險得多。呼叫端（下面三個 async 函式）
 * 會把這個例外轉成自己的安全結果型別。
 */
export function getDeleteJournalStorageKey(scopeKey: string): string {
  if (!isNonEmptyString(scopeKey)) {
    throw new TypeError('scopeKey 必須是非空字串');
  }
  // 原值直接串接，不 trim、不做大小寫轉換，維持與 Session scopeKey 完全一致。
  return `${DELETE_JOURNAL_KEY_PREFIX}${scopeKey}`;
}

/**
 * 允許的 phase 轉換表。
 *
 * `prepared` 是唯一有出路的狀態；`photo-deleted` 與 `uncertain` 都是終點。
 * 同一個 phase 轉到自己也不允許 —— 重複轉換通常代表狀態機接錯了，
 * 靜默放行會讓 updatedAt 被無意義地推進。
 */
const ALLOWED_TRANSITIONS: Record<DeleteJournalPhase, readonly DeleteJournalPhase[]> = {
  prepared: ['photo-deleted', 'uncertain'],
  'photo-deleted': [],
  uncertain: [],
};

/**
 * 建立 phase = `prepared` 的新紀錄。
 *
 * 這個函式只會在**真正呼叫刪除之前**使用，所以提早拋錯是安全的：
 * 此時還沒有任何照片被刪掉，中止流程不會留下不一致的狀態。
 *
 * 錯誤型別的慣例：型別或字串內容不合格 → TypeError；數值範圍不合格 → RangeError。
 */
export function createPreparedDeleteJournal({
  runId,
  scopeKey,
  batchIndex,
  totalBatches,
  batchIds,
  now,
}: {
  runId: string;
  scopeKey: string;
  batchIndex: number;
  totalBatches: number;
  batchIds: readonly string[];
  now: number;
}): DeleteJournalEntryV1 {
  if (!isNonEmptyString(runId)) {
    throw new TypeError('runId 必須是非空字串');
  }
  if (!isNonEmptyString(scopeKey)) {
    throw new TypeError('scopeKey 必須是非空字串');
  }
  if (!Number.isInteger(totalBatches) || totalBatches <= 0) {
    throw new RangeError(`totalBatches 必須是大於 0 的整數，收到 ${String(totalBatches)}`);
  }
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= totalBatches) {
    throw new RangeError(
      `batchIndex 必須是 0 到 ${totalBatches - 1} 之間的整數，收到 ${String(batchIndex)}`
    );
  }
  if (!Number.isFinite(now)) {
    throw new RangeError(`now 必須是有限數字，收到 ${String(now)}`);
  }
  if (!Array.isArray(batchIds)) {
    throw new TypeError('batchIds 必須是陣列');
  }
  if (batchIds.length === 0) {
    throw new RangeError('batchIds 至少要有一筆');
  }

  const seen = new Set<string>();
  for (let index = 0; index < batchIds.length; index += 1) {
    const id = batchIds[index];
    if (!isNonEmptyString(id)) {
      throw new TypeError(`batchIds 第 ${index} 筆不是有效的非空字串`);
    }
    if (seen.has(id)) {
      throw new TypeError(`batchIds 第 ${index} 筆重複`);
    }
    seen.add(id);
  }

  return {
    version: DELETE_JOURNAL_VERSION,
    runId,
    scopeKey,
    phase: 'prepared',
    batchIndex,
    batchNumber: batchIndex + 1,
    totalBatches,
    // 複製一份：之後呼叫端改動自己的陣列不會影響已建立的紀錄。
    batchIds: [...batchIds],
    createdAt: now,
    updatedAt: now,
    message: null,
  };
}

/**
 * 轉換 phase，回傳新的紀錄物件。
 *
 * `version`／`runId`／`scopeKey`／照片清單／`createdAt` 一律不變，只有
 * `phase`／`updatedAt`／`message` 會更新。原本的 entry 完全不會被修改，
 * `batchIds` 也會複製一份，不與原 entry 共用同一個陣列。
 */
export function transitionDeleteJournal(
  entry: DeleteJournalEntryV1,
  {
    nextPhase,
    now,
    message,
  }: {
    nextPhase: DeleteJournalPhase;
    now: number;
    message: string | null;
  }
): DeleteJournalEntryV1 {
  const allowed: readonly DeleteJournalPhase[] = ALLOWED_TRANSITIONS[entry.phase] ?? [];
  if (!isPhase(nextPhase) || !allowed.includes(nextPhase)) {
    throw new Error(`不允許的刪除紀錄轉換：${String(entry.phase)} -> ${String(nextPhase)}`);
  }
  if (!Number.isFinite(now)) {
    throw new RangeError(`now 必須是有限數字，收到 ${String(now)}`);
  }
  // 不讓 updatedAt 早於 createdAt：那樣產生的紀錄會被 validate 判為損壞，
  // 寫進去之後就再也讀不回來了。
  if (now < entry.createdAt) {
    throw new RangeError('now 不可早於 createdAt');
  }
  if (message !== null && typeof message !== 'string') {
    throw new TypeError('message 必須是字串或 null');
  }

  return {
    version: entry.version,
    runId: entry.runId,
    scopeKey: entry.scopeKey,
    phase: nextPhase,
    batchIndex: entry.batchIndex,
    batchNumber: entry.batchNumber,
    totalBatches: entry.totalBatches,
    batchIds: [...entry.batchIds],
    createdAt: entry.createdAt,
    updatedAt: now,
    message,
  };
}

/**
 * 驗證任意值是不是一筆合法的 v1 紀錄。**永遠不拋錯** —— 損壞的本機資料
 * 不可以讓 App crash。
 *
 * 通過時回傳的 entry 只含已知的 11 個欄位：未知欄位一律丟掉，不會被帶進
 * 記憶體，也不會在下一次保存時被寫回去。
 */
export function validateDeleteJournalEntry(value: unknown): DeleteJournalValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { valid: false, message: 'journal 必須是物件' };
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.version !== DELETE_JOURNAL_VERSION) {
    return { valid: false, message: `version 必須是 ${DELETE_JOURNAL_VERSION}` };
  }
  if (!isPhase(candidate.phase)) {
    return { valid: false, message: 'phase 不是合法值' };
  }
  if (!isNonEmptyString(candidate.runId)) {
    return { valid: false, message: 'runId 必須是非空字串' };
  }
  if (!isNonEmptyString(candidate.scopeKey)) {
    return { valid: false, message: 'scopeKey 必須是非空字串' };
  }
  if (!Number.isInteger(candidate.totalBatches) || (candidate.totalBatches as number) <= 0) {
    return { valid: false, message: 'totalBatches 必須是大於 0 的整數' };
  }
  const totalBatches = candidate.totalBatches as number;
  if (
    !Number.isInteger(candidate.batchIndex) ||
    (candidate.batchIndex as number) < 0 ||
    (candidate.batchIndex as number) >= totalBatches
  ) {
    return { valid: false, message: 'batchIndex 超出範圍' };
  }
  const batchIndex = candidate.batchIndex as number;
  if (candidate.batchNumber !== batchIndex + 1) {
    return { valid: false, message: 'batchNumber 必須等於 batchIndex + 1' };
  }
  if (!Array.isArray(candidate.batchIds) || candidate.batchIds.length === 0) {
    return { valid: false, message: 'batchIds 必須是至少一筆的陣列' };
  }

  const seen = new Set<string>();
  const batchIds: string[] = [];
  for (const id of candidate.batchIds as unknown[]) {
    if (!isNonEmptyString(id)) {
      return { valid: false, message: 'batchIds 含有無效的 ID' };
    }
    if (seen.has(id)) {
      return { valid: false, message: 'batchIds 含有重複的 ID' };
    }
    seen.add(id);
    batchIds.push(id);
  }

  if (!Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.updatedAt)) {
    return { valid: false, message: 'createdAt 與 updatedAt 必須是有限數字' };
  }
  const createdAt = candidate.createdAt as number;
  const updatedAt = candidate.updatedAt as number;
  if (updatedAt < createdAt) {
    return { valid: false, message: 'updatedAt 不可早於 createdAt' };
  }
  if (candidate.message !== null && typeof candidate.message !== 'string') {
    return { valid: false, message: 'message 必須是字串或 null' };
  }

  return {
    valid: true,
    entry: {
      version: DELETE_JOURNAL_VERSION,
      runId: candidate.runId,
      scopeKey: candidate.scopeKey,
      phase: candidate.phase,
      batchIndex,
      batchNumber: batchIndex + 1,
      totalBatches,
      batchIds,
      createdAt,
      updatedAt,
      message: candidate.message as string | null,
    },
  };
}

/**
 * 保存一筆紀錄。
 *
 * 會先驗證再寫入，所以不可能把一筆自己都讀不回來的資料寫進本機。
 * 寫進去的是**正規化後**的 entry（未知欄位已被丟掉）。
 * 保證不 reject。
 */
export async function saveDeleteJournalAsync(
  entry: DeleteJournalEntryV1
): Promise<DeleteJournalWriteResult> {
  const validation = validateDeleteJournalEntry(entry);
  if (!validation.valid) {
    return {
      ok: false,
      message: DELETE_JOURNAL_SAVE_FAILED_MESSAGE,
      cause: validation.message,
    };
  }

  try {
    const key = getDeleteJournalStorageKey(validation.entry.scopeKey);
    await AsyncStorage.setItem(key, JSON.stringify(validation.entry));
    return { ok: true };
  } catch (cause) {
    return { ok: false, message: DELETE_JOURNAL_SAVE_FAILED_MESSAGE, cause };
  }
}

/**
 * 讀取某個範圍的紀錄。保證不 reject。
 *
 * 損壞的資料**不會**被自動刪掉：它可能是唯一能說明「上一輪刪到哪裡」的線索，
 * 該由使用者在看過提示之後決定怎麼處理。
 */
export async function loadDeleteJournalAsync(
  scopeKey: string
): Promise<DeleteJournalLoadResult> {
  let key: string;
  try {
    key = getDeleteJournalStorageKey(scopeKey);
  } catch (cause) {
    return { status: 'failed', message: DELETE_JOURNAL_LOAD_FAILED_MESSAGE, cause };
  }

  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (cause) {
    // 儲存層失敗，不是「沒有紀錄」。這兩者混在一起會漏掉真正存在的 photo-deleted。
    return { status: 'failed', message: DELETE_JOURNAL_LOAD_FAILED_MESSAGE, cause };
  }

  if (raw === null || raw === undefined) {
    return { status: 'none' };
  }

  // 以下三種 corrupt 都要帶上「這一次讀到的」原始字串，之後才能精確清除。
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return { status: 'corrupt', message: DELETE_JOURNAL_CORRUPT_MESSAGE, rawValue: raw, cause };
  }

  const validation = validateDeleteJournalEntry(parsed);
  if (!validation.valid) {
    return {
      status: 'corrupt',
      message: DELETE_JOURNAL_CORRUPT_MESSAGE,
      rawValue: raw,
      cause: validation.message,
    };
  }

  // 紀錄裡的 scopeKey 必須與讀取用的 key 相符。
  // 對不上就代表資料被搬移或竄改過，絕不能把別的範圍的紀錄當成這個範圍的。
  if (validation.entry.scopeKey !== scopeKey) {
    return {
      status: 'corrupt',
      message: DELETE_JOURNAL_CORRUPT_MESSAGE,
      rawValue: raw,
      cause: `scopeKey 不一致：紀錄內為 ${validation.entry.scopeKey}`,
    };
  }

  return { status: 'loaded', entry: validation.entry };
}

/**
 * 安全清除某個範圍的紀錄。
 *
 * `expectedRunId` 是防呆用的：一個較舊的流程（例如使用者已經開始新的一趟刪除）
 * 絕對不可以把較新的 journal 清掉。runId 對不上時回報 `cleared: false`，
 * 這**不是**錯誤 —— 沒有東西該被清除本身就是正確結果。
 *
 * 損壞的紀錄一律不自動清除，回 `ok: false` 交給上層處理。保證不 reject。
 */
export async function clearDeleteJournalAsync(
  scopeKey: string,
  expectedRunId: string
): Promise<DeleteJournalClearResult> {
  if (!isNonEmptyString(expectedRunId)) {
    return {
      ok: false,
      cleared: false,
      message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE,
      cause: 'expectedRunId 必須是非空字串',
    };
  }

  const loaded = await loadDeleteJournalAsync(scopeKey);

  if (loaded.status === 'none') {
    return { ok: true, cleared: false };
  }
  if (loaded.status === 'corrupt') {
    return {
      ok: false,
      cleared: false,
      message: DELETE_JOURNAL_CORRUPT_MESSAGE,
      cause: loaded.cause,
    };
  }
  if (loaded.status === 'failed') {
    return {
      ok: false,
      cleared: false,
      message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE,
      cause: loaded.cause,
    };
  }
  if (loaded.entry.runId !== expectedRunId) {
    // 不是我這一趟的紀錄，什麼都不做。
    return { ok: true, cleared: false };
  }

  try {
    await AsyncStorage.removeItem(getDeleteJournalStorageKey(scopeKey));
    return { ok: true, cleared: true };
  } catch (cause) {
    return {
      ok: false,
      cleared: false,
      message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE,
      cause,
    };
  }
}

/**
 * 清除**損壞**的紀錄，但只在它與使用者當時看到的那一筆完全相同時才動手。
 *
 * `clearDeleteJournalAsync` 刻意拒絕清除 corrupt 資料（它可能是唯一的線索），
 * 所以損壞的紀錄本來沒有出口，該範圍會永遠卡住。這個函式是那個出口，
 * 但它必須嚴格到不可能誤刪：
 *
 * - 重新讀一次，**不信任**呼叫端先前拿到的內容
 * - 目前內容與 `expectedRawValue` 不是同一個字串就不動手
 * - 目前內容已經變成**有效**紀錄就不動手（有人在這期間寫了新的一筆）
 * - 只有「一字不差且仍然損壞」才 removeItem
 *
 * 換句話說：「某個 key 曾經 corrupt」永遠不足以構成刪除理由。
 * 保證不 reject，也不使用任何 fallback key。
 */
export async function clearCorruptDeleteJournalAsync(
  scopeKey: string,
  expectedRawValue: string
): Promise<DeleteJournalClearResult> {
  let key: string;
  try {
    key = getDeleteJournalStorageKey(scopeKey);
  } catch (cause) {
    return { ok: false, cleared: false, message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE, cause };
  }

  if (typeof expectedRawValue !== 'string') {
    return {
      ok: false,
      cleared: false,
      message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE,
      cause: 'expectedRawValue 必須是字串',
    };
  }

  let current: string | null;
  try {
    current = await AsyncStorage.getItem(key);
  } catch (cause) {
    return { ok: false, cleared: false, message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE, cause };
  }

  if (current === null || current === undefined) {
    // 已經沒有東西了。沒清到不是錯誤。
    return { ok: true, cleared: false };
  }

  if (current !== expectedRawValue) {
    // 內容在使用者確認期間被換掉了：不確定他同意的是不是這一筆，一律不動。
    return { ok: true, cleared: false };
  }

  // 再驗一次：萬一同樣的字串其實是有效紀錄（例如先前的判斷邏輯有變），
  // 那就不該被當成損壞資料刪掉。
  let parsed: unknown;
  let stillCorrupt = false;
  try {
    parsed = JSON.parse(current);
  } catch {
    stillCorrupt = true;
  }
  if (!stillCorrupt) {
    const validation = validateDeleteJournalEntry(parsed);
    if (validation.valid && validation.entry.scopeKey === scopeKey) {
      return {
        ok: false,
        cleared: false,
        message: '安全紀錄已經變更，未清除任何資料。',
        cause: 'raw value 已可解析成有效紀錄',
      };
    }
  }

  try {
    await AsyncStorage.removeItem(key);
    return { ok: true, cleared: true };
  } catch (cause) {
    return { ok: false, cleared: false, message: DELETE_JOURNAL_CLEAR_FAILED_MESSAGE, cause };
  }
}
