# ローカル音声出力（Kokoro / Fish Audio S2）実装計画

> 実装ステータス: ⬜ 未実装（計画・設計段階）

## 背景 / 調査結果

OpenCode の完了応答をローカル TTS で読み上げる先行実装として、
[`PureChocolate/opencode-voice-agent`](https://github.com/PureChocolate/opencode-voice-agent)
（参照コミット `6060622566a3e8f49a29314617bc950817da4c6d`）を調査した。

参照元の構成と特徴:

- OpenCode の global SSE を監視する Windows Python `voice_agent.py`、Kokoro HTTP サーバー、
  s2.cpp 接続、WASAPI 再生で構成される。
- 完了応答の読み上げ、Markdown のコード / 表 / URL 整形、最大 480 文字の文チャンク、
  1 チャンク先読み、Kokoro / S2 切替、ミュート、リプレイ、Ctrl+Shift+M / R、
  S2 の保存音声プロファイルを持つ。
- 現時点で 1 コミットのみ。テスト・リリース・コード用 LICENSE はない。

参照元から引き継がない事項:

- OpenCode の URL / ポート、Python 3.12 の絶対パス、TTS ポートがハードコードされている。
- Kokoro は `lang_code=a` と `af_heart` 固定。
- コードをコピーせず、挙動をクリーンルーム実装する（ライセンス不明のコードを混入させない）。

エンジン調査の確定事実:

- Kokoro モデル / 公式実装は Apache-2.0。8 言語 / 54 音声。日本語は `lang_code=j`、
  候補に `jf_alpha` 等がある。日本語 G2P は `misaki[ja]`。
- MVP 既定は日本語 `jf_alpha`、英語 `af_heart`、言語自動判定とする。
- s2.cpp は alpha / experimental。Fish Audio S2 関連物は Fish Audio Research License で、
  非商用利用は可能だが、配布時はライセンス添付、NOTICE の帰属表示、
  UI / 文書等で `Built with Fish Audio` 表示が必要。商用利用は別契約。
- s2.cpp / S2 は任意インストールの正式オプションにできるが、Kokoro を軽量既定エンジンにする。

## 目的

- タスク完了時に、アシスタントの最終応答をローカル TTS で読み上げる。
- 全文を外部クラウド TTS へ送信しない。初回モデル取得以外は完全ローカルで動作させる。
- 既定エンジンは Kokoro（軽量・Apache-2.0）、任意エンジンとして S2（Fish Audio Research License）を
  ライセンス表示・同意の上で導入可能にする。
- 既存の WebUI / host 基盤（global SSE、host 子プロセス管理、control API、認可）へ統合し、
  参照元のような独立 Python SSE エージェントを置かない。

## 対象 / 非対象

### 対象

- Windows 上の LeafCode host でのローカル合成と、ローカルまたは認証済みリモート WebUI の
  ブラウザ再生。
- active task の busy / retry → idle 遷移ごとの、最後の非空 assistant prose の読み上げ。
- v1 / v2 両方の message / status イベント。
- Kokoro の導入・起動・合成・再生、S2 の任意導入。
- ミュート、停止、最後の応答のリプレイ。

### 非目標（MVP）

- ブラウザを閉じている間のホストスピーカー再生。
- OS グローバルホットキー（Ctrl+Shift+M / R 等）。
- ブラウザとは別に、ホストスピーカーへ固定出力するバックグラウンド再生。
- subagent / reasoning / tool / synthetic / ignored メッセージの読み上げ。
- ノード単位（workflow graph の各ノード）の読み上げ。
- 参照音声アップロードによる S2 音声クローン作成（別フェーズ）。
- ストリーミング合成（MVP はチャンク単位の WAV 順次再生）。

## ライセンス・配布方針

- LeafCode 本体は MIT のまま変更しない。
- 制限付き S2 関連物を MIT へ再ライセンスしない。S2 関連は**別ライセンスの任意コンポーネント**として
  明示する。
- MIT は LeafCode 本体の商用利用を許可するため、配布先の用途まで「非商用」とは仮定しない。
  S2 の導入時に利用者自身の用途が非商用であることを確認させ、商用環境では S2 を導入・有効化しない。
- Kokoro は Apache-2.0 のため、既定エンジンとして本体と同一リポジトリで管理できる。
- S2 関連物（s2.cpp ビルド、GGUF、tokenizer、`s2voice` 等）は:
  - Fish Audio Research License を同梱・表示する。
  - NOTICE に帰属表示を追加する。
  - UI / 文書に `Built with Fish Audio` を表示する。
  - 非商用限定であることを設定 UI と文書に明示する。
- 参照元 `opencode-voice-agent` のコードはコピーしない。挙動のみをクリーンルーム実装する。

## 既存 LeafCode との統合方針

| 既存箇所 | 役割 | 統合方針 |
|----------|------|----------|
| `web/src/components/shell/GlobalAttentionProvider.tsx` | global SSE / 再接続（現在は独自 EventSource） | SSE transport を共通 `GlobalEventProvider` へ切り出し、重複 EventSource と再接続ロジックの複製を避ける |
| `web/src/lib/useSessionStream.ts` | v1 / v2 message / status イベント | 対象 message 詳細の取得と status 遷移の判定に利用 |
| `web/src/components/task/TaskView.tsx` | busy → idle 完了音 | 完了音と並行して読み上げトリガーを発火 |
| `web/src/lib/completion-report.ts` | assistant 本文抽出の既存補助 | `messageText` / `lastAssistantText` を読み上げ本文の抽出に再利用 |
| `web/src/components/shell/AppShell.tsx` | shell composition | `VoiceOutputProvider` を Provider 階層へ追加 |
| `web/src/components/settings/SettingsView.tsx` | 設定タブ | 音声設定セクションを追加 |
| `web/src/lib/settings-registry.ts` | 設定 allowlist / validation | 新キーを allowlist と validation へ追加 |
| `host/src/index.js` | 子プロセス、Job Object、ログ、tray status | voice service の起動・停止・監視・ログを統合 |
| `host/src/control-server.js` | host control API | voice の status / config / install / start / stop 契約を追加 |
| `web/src/lib/api-guard.ts` | 認可 | `requireAuthorized` / `requireHostMachine` を用途で使い分け |
| `scripts/start-webui.bat` | 起動 / 依存導入 | bat / cmd は ASCII-only。重い音声依存は通常の初回起動へ追加せず、設定画面から明示導入する |
| `deploy/Caddyfile.example` | loopback HTTPS の host-only API 経路 | `/api/host/voice*` を host-only matcher へ追加し、LAN / VPN からの管理操作を拒否する |

永続データ:

- モデル・venv は `%LOCALAPPDATA%` / `%APPDATA%` の LeafCode data dir（`dataDir()`）配下に置く。
- リポジトリ / OneDrive 配下に置かない（同期による破損・肥大を避ける）。

## アーキテクチャ図

```text
OpenCode global SSE
  -> 共通 GlobalEventProvider（SSE transport / 再接続を一元化）
  -> VoiceOutputProvider（standard task の読み上げ判定・キュー・重複排除）
  -> 対象 message 詳細の取得（v1 / v2 REST）
  -> sanitize / split（Markdown 整形、文チャンク分割）
  -> POST /api/voice/synthesize（BFF）
  -> host 管理 Kokoro / S2 adapter（voice service）
  -> WAV 応答
  -> ブラウザ再生（audio leader タブのみ）
```

- 別の Python SSE エージェントは置かない。SSE 購読は WebUI の共通 `GlobalEventProvider` が担う。
- TTS 合成は host が管理する voice service（Kokoro / S2 adapter）が担い、BFF は中継のみ。
- managed Kokoro service には host が起動ごとに生成する内部 token を環境変数で渡し、BFF からの
  要求で検証する。loopback bind と token の両方を必要とする。
- 再生先は MVP ではブラウザ。リモート端末はその端末で再生する。
- 複数タブは Web Locks 優先、BroadcastChannel fallback で audio leader を 1 つにする。

完了イベント源は実行方式ごとに分ける。standard task は global SSE の busy / retry → idle、
goal loop は永続化された turn / revision の完了（サーバー実行では busy SSE が欠落し得るため）、
workflow は Workflow Run の終端イベントを正とする。goal loop / workflow を global SSE の
status 遷移だけで推測しない。

## 機能仕様と既定値

| 項目 | 既定値 | 備考 |
|------|--------|------|
| 有効化 | 端末ごとに OFF | 新しいブラウザ / 端末では必ず明示有効化と audio unlock が必要 |
| エンジン | Kokoro | S2 は任意 |
| 対象タスク | active task のみ | 設定で全 top-level task に拡張可能 |
| 読み上げ対象 | 実行方式ごとの終端で最後の非空 assistant prose を 1 回だけ | standard は v1 / v2 status、goal loop / workflow は各永続状態を使用 |
| 重複排除 | sessionID + messageID の LRU | 同一応答の再読み上げを防ぐ |
| goal loop | 設定で各ターン | turn / revision 完了を使用し、busy SSE だけに依存しない |
| workflow | 最終 run 結果のみ | Workflow Run の終端イベントを使用し、ノードごとは読まない |
| キュー | latest-wins | 再生中の応答は継続し、待機中は最新 1 件だけ残す |
| Markdown | 見出し / リストは本文化 | fenced code / table / link は日本語 / 英語の短い cue、または設定で省略 |
| 読まないもの | URL 本体、reasoning / tool output | — |
| 文分割 | `Intl.Segmenter` の sentence segmentation 優先、句読点 fallback | 言語別にチャンク長を調整し、総読上げ文字数に上限を置く |
| 先読み | 1 チャンク先読み、WAV 順次再生 | — |
| audio unlock | 初回ユーザー操作で unlock | — |
| ミュート | OFF | ON にした時点で再生 / 合成 / 待機列を停止し、解除まで新規合成しない |
| 停止 | — | 現在の再生 / 合成 / 待機列だけを停止し、次の完了応答は通常どおり再生する |
| UI | ミュート、停止、最後の応答の再生 | 最後の整形済みチャンクはメモリ内だけに保持する |

## コンポーネント設計

### web（フロントエンド）

- `GlobalEventProvider`: `GlobalAttentionProvider` から SSE transport（EventSource 生成、
  再接続 backoff、silence / connect-stall 監視、`online` 再購読）を切り出した共通 Provider。
  `GlobalAttentionProvider` と `VoiceOutputProvider` の両方が購読する。
- `VoiceOutputProvider`: standard task の global SSE status 遷移、goal loop の turn / revision 完了、
  Workflow Run の終端イベントを正規化し、対象 message 詳細を取得して読み上げ本文を決定する。
  キュー、重複排除、audio leader を管理する。
- sanitize / split: 純粋関数として分離し、単体テスト可能にする。
  - Markdown 見出し / リストの本文化、fenced code / table / link の cue 化。
  - `Intl.Segmenter` による文分割、言語別チャンク長、総文字数上限。
- player: WAV を順次再生。AbortController で停止。audio unlock は初回ユーザー操作で実施。

### BFF（Next.js Route Handlers）

- `GET /api/voice/status`: エンジン / runtime 状態、導入状況、health。
- `POST /api/voice/synthesize`: `{ text, language, voice, speed }` を受け、host 経由で WAV を返す。
- `POST /api/voice/test`: テスト読み上げ。
- `/api/host/voice/{config,install,start,stop}`: 設定 UI から host control へ中継する
  host-only 管理 API。install は非同期 job を開始し、status で進捗を取得する。
- TTS 接続先は host が決定し、request から任意 URL を受け取らない（SSRF 防止）。
- body / MIME / timeout / Abort を検証し、レスポンスのキャッシュを禁止する。

### host

- `host/src/voice-service.js` 等の専用 manager:
  - 動的 loopback ポート、health 監視、restart budget、graceful stop。
  - managed service 用の起動ごとの内部 token を生成し、voice service と WebUI にだけ渡す。
  - Job Object への参加、`recordLog("voice", ...)`、tray / status 表示。
  - LeafCode quit / restart との連動。
- host control に status / config / install / install-cancel / start / stop の契約を追加。
  install は即座に job ID を返し、stage / progress / error / cancel 状態を status から取得する。
  - BFF の install / config / start / stop は `requireHostMachine`。
  - BFF の通常の synthesize / test / status は `requireAuthorized`。

### voice（Kokoro サービス）

- 新規 `voice/` ディレクトリ。Python 標準 HTTP サーバーまたは最小依存で loopback のみ待ち受ける。
- `GET /health`、`POST /generate`。JSON 入力 `{ text, language, voice, speed }`、`audio/wav` 出力。
- 単一 flight、入力上限、タイムアウト、pipeline キャッシュ。
- venv / model は LeafCode data dir に置く。
- 導入フロー（設定 UI から明示実行）:
  - Python 検出、必要なら winget による Python 導入。
  - venv 作成、pin 済み依存の導入。
  - 固定 revision / hash のモデル取得。
  - インストール中断 / 再試行 / 進捗 / ディスク容量を扱う。
  - 通常起動を失敗させない（未導入時は読み上げ無効のまま起動）。
- runtime は完全ローカル。初回モデル取得以外、文章を外部送信しない。

### S2（任意エンジン）

- 正式な任意エンジン。設定 UI からライセンス表示 / 同意後に導入可能。
- s2.cpp build または検証済み成果物、GGUF / tokenizer、backend（CPU / Vulkan / CUDA）、
  モデルサイズ / VRAM 表示。
- license / NOTICE / `Built with Fish Audio`、MIT と別ライセンス、非商用限定を明示。
- `/generate` multipart adapter、saved `.s2voice` ID、voice directory。
- 参照音声アップロード / クローン作成は別フェーズ:
  - 明示同意、音声 / transcript validation、削除、ローカル保存。
  - 秘密 / 個人情報をログに出さない。
- 既存の外部 loopback s2 server 接続もサポート可能だが、URL は loopback 限定。
  s2.cpp の HTTP server 自体に内部 token 検証がない場合、同一 OS ユーザーのローカルプロセスからの
  直接アクセスは残るため、設定 UI でこの信頼境界を明示する。

## 状態機械とキュー / 重複排除

### standard task の読み上げトリガー

```text
idle / null
  -> busy / retry（読み上げ対象ターン開始）
  -> idle（読み上げ対象ターン終了）
  -> 最後の非空 assistant prose を 1 回だけキューへ
```

- v1 / v2 の status イベント両方に対応する。
- `sessionID + messageID` をキーに LRU で重複排除する。
- subagent / reasoning / tool / synthetic / ignored は対象外。
- assistant message に完了時刻がない、error がある、または非空 prose がない場合はキューへ入れない。
- goal loop / workflow はそれぞれの永続状態にある完了識別子も重複排除キーへ含め、SSE status の
  欠落や再接続で同じ結果を二重に読まない。

goal loop は `revision` / turn の完了を検出して当該 turn の最終 assistant message を取得する。
workflow は Workflow Run が `completed` へ遷移したときだけ最終結果を取得する。
`failed` / `cancelled` は既存のエラー通知へ任せ、部分応答を自動読み上げしない。

### キュー

- 既定は latest-wins。新しい読み上げ要求が来たら待機列を空にして最新のみ再生する。
- 停止操作は再生中 WAV と進行中 HTTP 生成を AbortController で中止し、待機列を空にする。
- ミュート操作も現在の再生 / 合成 / 待機列を停止し、解除されるまで新規合成要求を送らない。
- リプレイ用の最後の整形済みチャンクはメモリ内だけに保持し、ブラウザや server storage へ永続化しない。
- 1 チャンク先読みで WAV を順次再生する。

### audio leader

- 複数タブで同時再生しない。Web Locks 優先、BroadcastChannel fallback で leader を 1 つにする。

## API 契約（概念 shape）

### BFF

```text
GET  /api/voice/status
  -> { enabled, engine, runtime: { state, installed, health }, voices, error? }

POST /api/voice/synthesize
  body: { text: string, language?: "ja" | "en" | "auto", voice?: string, speed?: number }
  -> audio/wav（または { error, code }）

POST /api/voice/test
  body: { voice?: string }
  -> audio/wav

GET  /api/host/voice/config
PUT  /api/host/voice/config
POST /api/host/voice/install
POST /api/host/voice/install/cancel
POST /api/host/voice/start
POST /api/host/voice/stop
  # requireHostMachine。install は 202 + { jobId }、進捗は /api/voice/status で取得
```

### host control

```text
GET  /voice/status
POST /voice/config
POST /voice/install
POST /voice/install/cancel
POST /voice/start
POST /voice/stop
```

### voice service（Kokoro）

```text
GET  /health
  -> { ok, engine, model, voices }

POST /generate
  header: Authorization: Bearer <per-run-internal-token>
  body: { text, language, voice, speed }
  -> audio/wav
```

## 設定 / データ保存

- 設定は**機械単位の engine / runtime**、**共有読み上げポリシー**、
  **端末ローカル再生状態**を分離する。
  - 機械単位: エンジン選択、導入状態、モデル、backend、音声プロファイル。
  - 共有読み上げポリシー: 対象タスク、goal loop、チャンク長、総文字数上限、cue 設定。
  - 端末ローカル再生状態: 有効 / 無効、ミュート、音量、audio unlock 状態。
- 曖昧な二重正本を作らない。機械単位の状態は host、共有読み上げポリシーは
  `settings-registry.ts` の allowlist、端末ローカル再生状態は localStorage を正とする。
  端末ローカル再生状態は server settings へ同期せず、新しい端末を意図せず読み上げ有効にしない。
- host は schema version 付き `voice-config.json` を data dir に atomic write し、既存の
  `secure-file.js` と同等の ACL を適用する。共有読み上げポリシーは既存の
  `createSettingSync` パターンに合わせ、localStorage の即時値と server settings の永続バックアップを
  同期する。
- 永続データは LeafCode data dir（`dataDir()`）配下:
  - `voice/venv/`、`voice/models/`、`voice/voices/`（S2 の `.s2voice`）。
- モデル・venv をリポジトリ / OneDrive 配下に置かない。

## セキュリティ / プライバシー

- managed Kokoro service は loopback のみで待ち受け、起動ごとの内部 token を検証する。
  token は URL、ログ、設定ファイル、ブラウザレスポンスへ出さない。
- TTS 接続先は host が決定し、request から任意 URL を受け取らない（SSRF 防止）。
- 外部 loopback s2 server 接続も URL は loopback 限定。
- 合成リクエストの本文（読み上げ対象テキスト）はログに残さない。
- S2 の参照音声 / transcript はローカル保存のみ。秘密 / 個人情報をログに出さない。
- 初回モデル取得以外、文章を外部送信しない。
- 認可: install / config / start / stop は `requireHostMachine` 相当、synthesize は `requireAuthorized`。
- 外部 s2 server は loopback 限定だが、サーバー自身が認証を提供しない場合のローカル直接アクセスを
  既知の制約として扱う。

## 障害時挙動

| 障害 | 挙動 |
|------|------|
| voice service 未導入 | 読み上げ無効のまま WebUI は通常起動。設定 UI に導入導線を表示 |
| voice service 起動失敗 | restart budget 内で再試行。超過時は読み上げ無効化し、tray / status に表示 |
| 合成タイムアウト / 入力上限超過 | 該当チャンクをスキップし、残りを継続。エラーは UI に表示 |
| SSE 切断 / 再接続 | 共通 `GlobalEventProvider` の再接続ロジックに従う。読み上げキューは保持 |
| ブラウザ再生失敗（autoplay 制限等） | 初回ユーザー操作で unlock。失敗時は UI に通知し、クラッシュさせない |
| LeafCode quit / restart | voice service を graceful stop し、Job Object から外す |
| ディスク容量不足（モデル取得時） | 導入を中断し、容量不足を明示。通常起動は継続 |

## 段階的実装フェーズと各完了条件

依存順に Phase 0 → Phase 6 を進める。各フェーズの完了条件（ゲート）を満たすまで次へ進めない。

### Phase 0: 仕様 / ライセンス / 日本語品質 spike

- 本仕様の確定、ライセンス方針（Kokoro Apache-2.0 / S2 Fish Audio Research License）の確認。
- 実装時点の対象バージョンについてライセンス原文と配布条件を再確認する。
- Kokoro 日本語（`jf_alpha`、`misaki[ja]`）の読み上げ品質 spike。
- 完了条件: ライセンス方針と日本語品質の評価結果が文書化され、Phase 1 以降の前提が確定する。

### Phase 1: 共通 event と pure text core

- `GlobalEventProvider` への SSE transport 切り出し（`GlobalAttentionProvider` の挙動を回帰させない）。
- sanitize / split の純粋関数実装と単体テスト。
- 完了条件: `GlobalAttentionProvider` の既存テストが全て通り、sanitize / split が単体テストで保護される。

### Phase 2: Kokoro service + installer backend

- `voice/` の Kokoro HTTP サービス（`/health`、`/generate`）。
- Python 検出、venv、pin 済み依存、モデル取得を行う非対話 installer backend と、
  進捗 / 中断 / 再試行を表現する job state を実装する。この段階では CLI / テストから呼び出す。
- 完了条件: installer backend で導入した voice service が日本語 / 英語の WAV を返し、job state が
  中断・再試行・ディスク容量不足を扱える。

### Phase 3: host + BFF

- `host/src/voice-service.js`（動的 loopback ポート、health、restart budget、Job Object、ログ、tray）。
- host control の status / config / install / install-cancel / start / stop 契約。
- BFF の `/api/voice/status`、`/api/voice/synthesize`、`/api/voice/test` と
  `/api/host/voice/{config,install,start,stop}`。
- 完了条件: host が voice service を起動・監視・停止でき、BFF 経由で WAV が返る。
  installer job の開始 / 進捗取得 / cancel と認可（`requireHostMachine` / `requireAuthorized`）が効く。

### Phase 4: UI / player

- `VoiceOutputProvider`、audio leader（Web Locks / BroadcastChannel）、WAV 順次再生。
- standard / goal loop / workflow の完了イベント源を統合し、実行方式ごとの重複排除を実装。
- 設定 UI（導入進捗、有効化、エンジン、対象タスク、cue、チャンク長、総文字数上限）。
- ミュート、停止、最後の応答の再生。
- 完了条件: standard / goal loop / workflow の各終端で対象応答が 1 回だけ読み上げられ、
  ミュート / 停止 / リプレイが動作する。新しい端末では既定 OFF のままになる。

### Phase 5: S2

- ライセンス表示 / 同意後の任意導入、s2.cpp build または検証済み成果物。
- `/generate` multipart adapter、`.s2voice` ID、voice directory。
- 完了条件: 同意後に S2 が導入でき、Kokoro と切替えて合成できる。NOTICE / `Built with Fish Audio` 表示が入る。

### Phase 6: hardening / docs / release

- 障害時挙動の回帰テスト、セキュリティ回帰、`npm run test:encoding`。
- 文書（README、本仕様のステータス更新、ライセンス表記）の整備。
- 完了条件: 受入基準を全て満たし、配布物にライセンス / NOTICE が含まれる。

## 主な変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `web/src/components/shell/GlobalAttentionProvider.tsx` | SSE transport を共通 Provider へ切り出し |
| `web/src/components/shell/GlobalEventProvider.tsx`（新規） | 共通 SSE transport / 再接続 |
| `web/src/components/shell/VoiceOutputProvider.tsx`（新規） | 読み上げ判定・キュー・重複排除・audio leader |
| `web/src/lib/voice-completion-source.ts`（新規） | standard / goal loop / workflow の完了イベント正規化 |
| `web/src/lib/voice-text.ts`（新規） | sanitize / split の純粋関数 |
| `web/src/lib/voice-player.ts`（新規） | WAV 順次再生、AbortController、audio unlock |
| `web/src/components/shell/AppShell.tsx` | Provider 階層へ追加 |
| `web/src/components/settings/SettingsView.tsx` | 音声設定セクション |
| `web/src/lib/settings-registry.ts` | 設定キーの allowlist / validation |
| `web/src/app/api/voice/{status,synthesize,test}/route.ts`（新規） | 認証済み利用者向け BFF voice API |
| `web/src/app/api/host/voice/**/route.ts`（新規） | host-only の config / install / start / stop API |
| `host/src/voice-service.js`（新規） | voice service manager |
| `host/src/control-server.js` | voice の control 契約 |
| `host/src/index.js` | 起動・停止・Job Object・ログ・tray 連動 |
| `voice/`（新規） | Kokoro HTTP サービス、導入スクリプト |
| `deploy/Caddyfile.example` | `/api/host/voice*` を host-only matcher へ追加 |
| `scripts/start-webui.bat` | 変更しない（重い音声依存を初回起動へ追加しない） |

## テスト計画 / 検証コマンド

- web: `npm --prefix web run typecheck`、`npm --prefix web run lint`、`npm --prefix web test`
- host: `npm --prefix host test`
- エンコーディング: `npm run test:encoding`
- 本番 build / 常駐 server（`next build`、`next start`、`npm run dev` 等）は
  **エージェントが実行しない**。コード正しさは typecheck / lint / vitest で確認し、
  本番ビルドの検証はユーザーに委ねる。
- 追加テスト:
  - sanitize / split の単体テスト（Markdown cue、文分割、チャンク長、総文字数上限）。
  - 重複排除（sessionID + messageID LRU）の単体テスト。
  - host control の voice 契約テスト（`control-server.test.js` と同形式）。
  - BFF の認可テスト（`requireHostMachine` / `requireAuthorized`）。
  - managed voice service の内部 token 欠落 / 不一致 / 非露出テスト。
  - standard / goal loop / workflow の完了イベント源と重複排除テスト。
  - audio leader（Web Locks / BroadcastChannel）のテスト。
  - Caddy host-only matcher と API guard coverage の回帰テスト。
  - 実機スモーク: Kokoro 導入 → 読み上げ → ミュート / 停止 / リプレイ。

## 受入基準

1. 初期状態と新しいブラウザ / 端末では読み上げ OFF。設定 UI から明示導入・有効化できる。
2. standard task の busy / retry → idle、goal loop の turn 完了、Workflow Run の終端で、
   対象となる最後の非空 assistant prose が 1 回だけ読み上げられる。
3. subagent / reasoning / tool / synthetic / ignored は読み上げない。
4. 同一応答（sessionID + messageID）は重複して読み上げない。
5. Markdown のコード / 表 / URL は cue 化または省略され、URL 本体を読まない。
6. 停止操作で再生と進行中合成が中止され、待機列が空になる。
   ミュート中は新しい合成要求を送らず、解除後の次の完了応答から再開する。
7. 複数タブで同時再生されない（audio leader が 1 つ）。
8. managed voice service は loopback のみで待ち受け、正しい起動ごとの内部 token がなければ
   合成できない。
9. TTS 接続先は host が決定し、request から任意 URL を受け取らない。
10. 初回モデル取得以外、文章を外部送信しない。合成本文はログに残さない。
11. voice service 未導入・起動失敗時も WebUI は通常起動し、読み上げ無効のまま動作する。
12. S2 はライセンス表示 / 同意後にのみ導入でき、NOTICE / `Built with Fish Audio` 表示が入る。
13. LeafCode quit / restart で voice service が graceful stop する。
14. `npm --prefix web run typecheck`、`npm --prefix web run lint`、`npm --prefix web test`、
    `npm --prefix host test`、`npm run test:encoding` が通る。

## ロールバック / 無効化

- 設定 UI から読み上げを OFF にすると、キューを空にし、再生を停止し、以後の合成要求を出さない。
- voice service は host が停止し、Job Object から外す。
- 導入済みの venv / モデルは data dir 配下に置くため、削除してもリポジトリは汚れない。
- 設定キーは `settings-registry.ts` の allowlist から外すだけで無効化できる。
- 共通 `GlobalEventProvider` への切り出しは、`GlobalAttentionProvider` の既存テストで回帰を検出する。

## 参照資料 URL

- 参照元: https://github.com/PureChocolate/opencode-voice-agent
  （参照コミット `6060622566a3e8f49a29314617bc950817da4c6d`）
- Kokoro: https://huggingface.co/hexgrad/Kokoro-82M
- s2.cpp: https://github.com/rodrigomatta/s2.cpp
- Fish Audio Research License: https://github.com/fishaudio/fish-speech/blob/main/LICENSE
