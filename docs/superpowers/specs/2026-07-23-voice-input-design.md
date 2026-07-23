# 音声入力 仕様

# 音声入力設計

## 目的

Home 画面（新規タスク入力）と Task 画面（フォローアップ入力）の両方の composer で、Web Speech API を用いた音声認識入力を提供する。ユーザーはマイクボタンを押して話し、認識されたテキストを既存の入力内容に追記できる。外部 API やサードパーティ依存は一切持たない。

## 採用 API

- **Web Speech API** の `SpeechRecognition`（標準）または `webkitSpeechRecognition`（ベンダープレフィックス）を機能検出で使用する。
- サーバーサイド、外部音声認識サービス、クラウド API は使用しない。すべてブラウザのネイティブ音声認識で完結する。
- ネットワーク経由の認識はブラウザ実装に委ねる（Chrome は Google サーバー、Safari は Apple サーバー等）。本仕様はその選択に関与しない。

## 機能検出

- モジュール読み込み時または初回レンダリング時に、`typeof window !== "undefined"` を確認した上で `window.SpeechRecognition ?? window.webkitSpeechRecognition` の存在を判定する。
- 未対応ブラウザではマイクボタンを非表示にする（DOM から除去）。無効ボタンのグレーアウト表示は行わない。
- 判定結果は React state または ref に一度だけ保持し、再レンダリングごとに再計算しない。

## 共通フック: `useVoiceInput`

Home と Task の両 composer で同一のカスタムフック `useVoiceInput` を使用する。

### 配置

`web/src/lib/use-voice-input.ts` に実装する。

### シグネチャ

```ts
interface UseVoiceInputOptions {
  /** composer がロック中（送信中・タスク動作中）か。true の間は認識を開始しない */
  disabled?: boolean;
}

interface UseVoiceInputReturn {
  /** ブラウザが Web Speech API に対応しているか */
  supported: boolean;
  /** 現在認識中か */
  listening: boolean;
  /** 認識を開始する。disabled のときは何もしない */
  start: () => void;
  /** 認識を停止する。end イベント後に確定されたテキストを返す */
  stop: () => Promise<string>;
  /** 最後に確定した認識テキスト（追記用） */
  transcript: string;
  /** エラーメッセージ（null = エラーなし） */
  error: string | null;
  /** エラーをクリアする */
  clearError: () => void;
}
```

`stop()` は `SpeechRecognition` の `end` イベントまで待機して Promise を解決するため、停止要求後に届く最後の確定 `result` も返却値に含める。認識が `disabled` 化によって中断された場合またはフックがアンマウントされた場合は、未解決の `stop()` も `""` で解決する。停止完了前に複数回呼び出されても同一の Promise を返す single-flight とし、ネイティブの `recognition.stop()` は1回だけ呼ぶ。`error` イベントまたは `recognition.stop()` の例外発生時は、待機中の `stop()` を即座に解決する。`end` イベントを発火しないブラウザ実装では旧セッションが閉じないため、次回の `start()` は保留される既知の制限がある。

### 内部状態

| 状態 | 型 | 説明 |
|------|----|------|
| `supported` | `boolean` | 初回判定結果。変更不可 |
| `listening` | `boolean` | `SpeechRecognition` が `start()` 後 `end` / `error` 発火前か |
| `transcript` | `string` | 最後に確定した認識結果（`result.isFinal === true` の `transcript` を連結） |
| `error` | `string \| null` | エラーメッセージ。`no-speech` / `aborted` は null にリセット |

### SpeechRecognition の設定

| プロパティ | 値 | 理由 |
|-----------|-----|------|
| `lang` | 設定しない | ブラウザの既定言語に従う。固定 `ja-JP` 等は指定しない |
| `continuous` | `true` | ユーザーが明示停止するまで話し続けられるようにする |
| `interimResults` | `false` | 確定結果だけを扱い、途中認識は表示しない |
| `maxAlternatives` | `1` | 最良の認識結果のみ使用する |

### イベントハンドリング

| イベント | 処理 |
|---------|------|
| `result` | `event.results` を走査。`isFinal` が `true` のものだけ `transcript` に追記（スペース区切り）。途中認識は無効化しているため扱わない |
| `end` | `listening` を `false` に設定。`continuous: true` でもブラウザが自動停止することがあるため、`listening` は必ずリセットする |
| `error` | `error` 状態を設定。`"no-speech"` / `"aborted"` はエラー表示せず静かにリセット（ユーザー操作の中断や無音タイムアウト）。`"not-allowed"`（権限拒否）はエラーメッセージを表示。`"language-not-supported"` / `"service-not-allowed"` / `"audio-capture"` 等もエラーメッセージを表示する |
| `start` | `listening` を `true` に設定。`error` をクリアする |

### disabled の動作

- `disabled === true` のときに `start()` が呼ばれても何もしない（`SpeechRecognition.start()` を呼ばない）。
- 認識中に `disabled` が `true` になった場合、`stop()` を自動呼び出しして認識を強制終了する。このときの `transcript` は composer に反映しない（破棄する）。

### クリーンアップ

- フックのアンマウント時、認識中であれば `abort()` を呼び、`listening` を `false` にリセットする。
- `SpeechRecognition` インスタンスはフックの生存期間中に1回生成し、アンマウント時に `abort()` + `null` 代入で解放する。

## マイクボタンコンポーネント: `VoiceInputButton`

### 配置

`web/src/components/VoiceInputButton.tsx` に実装する。

### プロパティ

```ts
interface VoiceInputButtonProps {
  /** useVoiceInput の戻り値 */
  voice: UseVoiceInputReturn;
  /** 認識テキストを受け取るコールバック。stop() の戻り値が渡される */
  onTranscript: (text: string) => void;
  /** disabled 時はボタンも非活性にする（useVoiceInput の disabled と同期） */
  disabled?: boolean;
}
```

### UI

- アイコン: 非認識中は `Mic`（lucide-react）、認識中は `MicOff` または録音中のアニメーション（`Mic` に赤色 dot または pulse）。
- ツールチップ: 非認識中は「音声入力」、認識中は「音声入力を停止」。
- サイズ・スタイル: 既存のツールバーボタン（画像添付ボタン等）と統一する。`flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40`。
- 未対応ブラウザ: ボタンを DOM にレンダリングしない（`voice.supported === false` のとき `null` を返す）。

### 動作

| 操作 | 状態 | 動作 |
|------|------|------|
| クリック | 非認識中・`disabled === false` | `voice.start()` を呼ぶ |
| クリック | 認識中 | `voice.stop()` を呼び、戻り値を `onTranscript` に渡す |
| クリック | `disabled === true` | 何もしない（`pointer-events` または `disabled` 属性で防止） |

### アクセシビリティ

- `<button>` 要素を使用し、`type="button"` を指定する。
- `aria-label` は状態に応じて動的に変更する: 非認識中は `"音声入力"`、認識中は `"音声入力を停止"`。
- `aria-pressed` に `listening` の値を設定する。
- 認識中は `aria-live="polite"` を設定した領域に `"認識中"` テキストを配置する（スクリーンリーダーに状態変化を通知）。
- エラー発生時は `role="alert"` を設定した要素にエラーメッセージを表示する。

## エラー表示

- エラーは composer の入力欄直下またはツールバー内にインラインで表示する。
- 表示内容:
  - `"not-allowed"`: 「マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。」
  - `"audio-capture"`: 「マイクが見つかりません。マイクが接続されているか確認してください。」
  - `"language-not-supported"`: 「この言語は音声認識に対応していません。」
  - `"service-not-allowed"`: 「音声認識サービスが利用できません。」
  - その他: 「音声認識でエラーが発生しました。」
- エラーは `voice.clearError()` または次回の `voice.start()` 成功時にクリアされる。
- エラー表示領域は `aria-live="polite"` とし、動的に挿入・削除する。

## 認識テキストの composer への反映

- 認識が停止したとき（ユーザーが停止ボタンを押したとき）のみ、`onTranscript` を通じて確定テキストが composer に渡される。
- composer 側の処理:
  1. 現在の入力値の末尾に、認識テキストを追記する。
  2. 追記前に末尾が空白でなければ空白1つを挿入してから追記する。
  3. カーソルを末尾に移動する。
  4. textarea の高さを自動調整する（既存の `autoResize` / `style.height` ロジックを呼ぶ）。
- 認識中に composer の入力値がユーザーによって変更されても、確定テキストは常に現在の入力値の末尾に追記される（ユーザーの編集中内容を上書きしない）。
- 自動送信は行わない。

## ロック中の動作

- `composerLocked`（TaskView）または `submitting`（HomeView）が `true` の間は、`useVoiceInput` の `disabled` に `true` を渡す。
- ロック中はマイクボタンが非活性（`disabled` 属性 + `opacity-40`）になり、クリックしても認識を開始しない。
- 認識中にロックがかかった場合、フック内部で自動停止し、その認識結果は破棄される。

## 実装手順

1. `web/src/lib/use-voice-input.ts` を作成する。
2. `web/src/components/VoiceInputButton.tsx` を作成する。
3. `HomeView.tsx` のツールバー（1段目、画像添付ボタンの隣）に `VoiceInputButton` を追加する。
4. `TaskView.tsx` のツールバー（画像添付ボタンの隣）に `VoiceInputButton` を追加する。
5. 両 composer で `useVoiceInput({ disabled: composerLockedOrSubmitting })` を呼び出し、`onTranscript` で入力値末尾に追記する処理を実装する。
6. テストを作成する。

## アクセシビリティ（再掲・補足）

- マイクボタンはキーボード操作可能（`Enter` / `Space` で開始・停止）。
- 認識中は視覚的インジケーター（アイコン変化 + 色）に加え、`aria-live` 領域で状態を通知する。
- エラーメッセージは `role="alert"` で通知する。
- 未対応ブラウザではボタン自体をレンダリングせず、フォーカス不能な要素を残さない。

## テスト方針

### ユニットテスト（`use-voice-input.test.ts`）

- `supported` が機能検出結果と一致すること。
- `start()` が `SpeechRecognition.start()` を呼ぶこと。
- `stop()` が `SpeechRecognition.stop()` を呼び、`transcript` を返すこと。
- `disabled === true` のとき `start()` が何もしないこと。
- 認識中に `disabled` が `true` になったとき自動停止し `transcript` が空であること。
- `result` イベントで `isFinal` のテキストのみ `transcript` に蓄積されること。
- `error` イベントで適切なエラーメッセージが設定されること。
- `"no-speech"` / `"aborted"` はエラー表示しないこと。
- アンマウント時に `abort()` が呼ばれること。

### コンポーネントテスト（`VoiceInputButton.test.tsx`）

- `supported === false` のときボタンがレンダリングされないこと。
- クリックで `voice.start()` / `voice.stop()` が呼ばれること。
- `disabled === true` のときクリックが無視されること。
- `aria-label` と `aria-pressed` が状態と一致すること。
- エラー表示が正しくレンダリングされること。

### 結合テスト（`HomeView.test.tsx` / `TaskView.test.tsx`）

- 音声認識の確定テキストが composer の入力値に追記されること。
- ロック中はマイクボタンが非活性であること。
- 既存の送信・添付・スラッシュコマンドのテストが PASS すること。

### モック方針

- `window.SpeechRecognition` / `window.webkitSpeechRecognition` を `vi.stubGlobal` でモックする。
- モックは `start` / `stop` / `abort` の各メソッドと、`result` / `end` / `error` / `start` イベントの `addEventListener` / `removeEventListener` を提供する。
- テスト内で `mockSpeechRecognition.dispatchEvent(new Event("result"))` のようにイベントを発火できるようにする。

## 非目標

- サーバーサイド音声認識、クラウド音声認識 API（Whisper 等）の統合。
- 音声認識結果の自動送信。
- 途中認識結果（interim results）のリアルタイム表示。
- 音声認識言語の手動選択 UI。
- 音声認識のキーボードショートカット（Ctrl+Shift+M 等）。
- 録音波形の可視化。
- 音声入力履歴の保存。
- オフライン音声認識。
- カスタム音声コマンド（「送信して」等の音声トリガー）。
- マイクボタンの長押しで録音・離して確定（PushtoTalk スタイル）。
- モバイルでのネイティブ音声入力（OS 標準の音声入力キーボード）との置き換え。本機能は Web Speech API の補助的提供であり、モバイルでは OS 標準の音声入力キーボードが優先される。
