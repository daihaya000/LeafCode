# プロバイダー / モデル 有効化設定仕様

## 目的

WebUI の設定画面に「プロバイダー/モデル」タブを追加し、利用可能な AI プロバイダーとそのモデルを一覧表示して個別に有効 / 無効を切り替えられるようにする。無効化したプロバイダーおよびモデルは、Home / Task / Settings のモデルドロップダウンから消える。

## 背景

- OpenCode は `opencode.jsonc` のトップレベル `disabled_providers` / `enabled_providers` 配列でプロバイダー全体の有効 / 無効を制御できる。
- `provider.<id>.whitelist` / `blacklist` でモデル単位のフィルタが可能だが、WebUI では「各モデルの on/off スイッチ」として直感的に管理したい。
- WebUI 独自の「表示フィルタ」として無効化を管理し、OpenCode 設定には一切書き込まない。これにより、OpenCode 本体の接続状態やコスト計算に影響を与えず、表示・選択範囲だけを制御する。

## 対象と非対象

- 対象: `/api/opencode/provider` から取得できる全プロバイダーとモデル。
- 非対象: プロバイダー認証情報、API キー、baseURL、コスト設定などの編集。これらは従来通り手動で `opencode.jsonc` を編集する。

## 状態の保存先

- WebUI ローカル状態ファイル: `%APPDATA%\opencode-webui\provider-model-state.json`
- 形式: `{ disabled: { [providerID]: boolean; [providerID::modelID]: boolean } }`
- 無効なキーが `true` として保存される。キーはプロバイダーIDまたは `providerID::modelID`。
- OpenCode 設定を変更せず、WebUI 管理の表示フィルタとしてのみ動作する。

## 新規モデルの既定状態（Fast / 旧世代の自動無効化）

- OpenCode が新しいモデルを追加で公開したとき、そのモデルをこの WebUI プロファイルで初めて見た時点で、以下のルールに基づき既定の有効/無効を自動決定する。
  - モデル id に `fast` というトークンが含まれる（例: `gpt-5.6-sol-fast`）→ 既定で無効。
  - 同じプロバイダー内のモデル群からバージョン（`major.minor`）を抽出し、そのモデルのバージョンが最新から数えて2世代以上古い場合 → 既定で無効。
  - バージョンを抽出できないモデル（`auto` など）は既定で有効のまま。
- 判定は `web/src/lib/model-options.ts` の `isFastModelId` / `shouldDefaultDisableModel` が行う。
- 一度でも決定された（自動判定または手動トグル）モデルは `provider-model-state.json` の `knownModelKeys` に記録され、以後は再評価されない。手動でオン/オフを切り替えた後は、新しいバージョンが増えても勝手に戻らない。
- 後方互換: この機能が実装される前に作成された状態ファイル（`knownModelKeys` フィールドが存在しない）は、初回読み込み時に現在見えている全モデルを「既知」としてグランドファーザーし、自動無効化ルールは適用しない。これにより、既存プロファイルで暗黙的に有効だったモデルがアップグレードで急に無効化されることはない。新しいモデルが後から追加された時点で、初めてこのルールが適用される。

## API

### `GET /api/extensions/provider-models`

一覧を返す。

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "enabled": true,
      "models": [
        { "id": "gpt-5", "name": "GPT-5", "enabled": true }
      ]
    }
  ]
}
```

- `/api/opencode/provider` から取得した `all` / `connected` / `default` を元にする。
- 各プロバイダーの有効状態はローカル状態ファイルを参照する。
- モデルの有効状態も同ファイルを参照する。プロバイダーが無効な場合、配下のモデルは `enabled: false` として返すが、エントリ自体は残す（プロバイダー再開時に個別のモデル状態を復元できる）。

### `PATCH /api/extensions/provider-models/:key`

- `:key` は `providerID` または `providerID::modelID`。
- リクエスト本文: `{ enabled: boolean }`
- ローカル状態ファイルの `disabled` オブジェクトを更新する。
  - `enabled: false` → `disabled[key] = true`
  - `enabled: true` → `disabled[key]` を削除
- プロバイダーを無効化しても、配下モデルの個別状態は上書きしない。
- プロバイダーを有効化しても、個別に無効化されたモデルはそのまま無効のまま。

## UI

### 「プロバイダー/モデル」タブ

- `SettingsView` の `SettingsTab` に `"providers"` を追加する。
- タブラベルは「プロバイダー/モデル」。
- 各プロバイダーをグループとして表示する。
  - 行: アイコン、プロバイダー名、状態バッジ（有効 / 無効）、有効 / 無効スイッチ。
  - 配下モデルを折りたためるリストとして表示。各モデルにも同様に状態バッジとスイッチ。
- プロバイダーを無効化すると、その配下モデルは視覚的に無効表示され、スイッチは disabled にする。
- 既存の ExtensionsSettings と同様に、ローディング、空状態、エラー、再試行、一時的な disable 中の `aria-busy` を実装する。
- モデル単位の切り替えが可能。プロバイダー無効時はモデルスイッチを操作不能にする。

### ドロップダウン絞り込み

- `model-options.ts` に `filterEnabledModels(options, disabledSet)` ヘルパーを追加する。
- `HomeView`、`TaskView`、`SettingsView` のデフォルトモデルセレクタで、ローカル状態ファイルを読み込み、無効なプロバイダー・モデルをドロップダウンから除外する。
- 現在選択中のモデルが無効化された場合、ドロップダウン値はクリアされず「選択できない値」として表示する（ユーザーが明示的に変更するまで保持）。ただし、新規タスク作成時の自動選択では候補から外す。
- ドロップダウンの選択肢更新は `enabled` 状態を即座に反映する。

## 受入条件

1. 設定画面に「プロバイダー/モデル」タブが表示される。
2. タブで各プロバイダーとモデルの有効 / 無効を切り替えられる。
3. 無効化したプロバイダーとモデルが Home / Task / Settings のドロップダウンから消える。
4. プロバイダーを無効化しても、配下モデルの個別状態は保持される。
5. ローカル状態ファイルのみを変更し、OpenCode 設定ファイルは変更しない。
6. 型チェックと既存テストが全て通る。
