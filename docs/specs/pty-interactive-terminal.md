# PTY 対話ターミナル

## 背景

現行の `PtyPanel.tsx` は OpenCode engine の `GET /pty`（PTY 一覧）だけを呼び出す
読み取り専用のステータス表示であり、コード内コメントで
`Lightweight PTY status panel — full interactive terminal is Phase P2 follow-up.`
と明記されている。画面上にも「稼働中の PTY はありません。対話入力 UI は次フェーズで
追加します。」と表示される。

一方 `web/src/lib/opencode.ts` の `isBlockedOpencodeWrite()` は、汎用プロキシ
`api/opencode/[...path]/route.ts` と `ocServer()` の両方から呼ばれる共通ブロックリストで、
PTY の作成・更新・削除・WebSocket 接続チケット発行を明示的に禁止している。

```ts
// Session shell — arbitrary command execution (PTY-equivalent)
if (m === "POST" && /^\/session\/[^/]+\/shell$/.test(p)) return true;
// PTY create/update/delete/connect-token — remote shell equivalent
if (m === "POST" && p === "/pty") return true;
if (m === "PUT" && p.startsWith("/pty/")) return true;
if (m === "DELETE" && p.startsWith("/pty/")) return true;
if (m === "POST" && /^\/pty\/[^/]+\/connect-token$/.test(p)) return true;
```

コメント `remote shell equivalent` が示すとおり、この禁止は放置ではなく、
汎用プロキシ経由で任意シェルを起動・接続できてしまうリスクに対する意図的な設計判断である。
対話ターミナルを実装するには、この禁止を緩めるのではなく、
スコープを限定した専用の許可経路を新設する必要がある。

## 目的

- WebUI から OpenCode engine の PTY を作成し、xterm 相当の対話 UI で
  入出力できるようにする。
- 汎用プロキシのブロックリストを緩めず、PTY 専用の狭いスコープを持つ
  BFF API 経路だけを新設して許可する。
- PTY セッションのライフサイクル（作成・resize・一覧・終了）と
  WebSocket 入出力を通じて、既存の loopback 前提・監査方針と整合させる。
- 既存の `remote-authz.md` で定義された認証・認可基盤を持つリモート利用時にも、
  この機能が権限モデル外の抜け穴にならないことを保証する。

## 非目標

- `isBlockedOpencodeWrite()` の PTY / session-shell ブロックを汎用プロキシ側で解除すること。
- リモート利用者（`remote-authz.md` の主体）への対話ターミナル公開の具体設計。
  初期実装は loopback（host-only）利用者に限定し、リモート公開は別仕様として扱う。
- OpenCode engine 側の PTY 実装（`pty.create` / `pty.connectToken` 等）の変更。
- 複数利用者間での PTY セッション共有・引き継ぎ。
- ターミナル内で実行されるコマンドそのものの承認フロー（既存 permission 機構の変更）。

## 用語

| 用語 | 意味 |
|------|------|
| Engine | `OPENCODE_BASE_URL`（既定 `http://127.0.0.1:4096`）で待ち受ける OpenCode engine 本体。 |
| BFF | Next.js Route Handlers。ブラウザと Engine の間に立つ唯一のサーバー。 |
| 汎用プロキシ | `api/opencode/[...path]/route.ts` および `ocServer()`。`isBlockedOpencodeWrite()` を必ず通す。 |
| PTY 専用 API | この仕様で新設する `api/pty-session/**` 配下の BFF ルート。汎用プロキシを経由しない。 |
| ticket | Engine の `POST /pty/{id}/connect-token` が発行する短命 WebSocket 接続トークン。 |
| PTY セッション | Engine が管理する 1 つの疑似端末プロセス（`components["schemas"]["Pty"]`）。 |

## 現状のセキュリティ境界（維持する前提）

- 汎用プロキシはブロックリスト方式。`isBlockedOpencodeWrite()` に新しい例外を足さない。
- PTY 作成・接続は `session shell` と同格の「remote shell equivalent」として扱われている。
  この機能を有効化する = ブラウザから任意コマンド実行を許可することであるため、
  host-only（loopback）限定を既定にする。
- 既存の `rejectUnlessLocal` 相当のホスト制限（`remote-authz.md` の host-only API と同じ扱い）を
  PTY 専用 API にも適用する。

## 提案アーキテクチャ

```
Browser (xterm.js)
  → PTY 専用 API (api/pty-session/**, host-only)
      - POST   /api/pty-session              PTY 作成（Engine POST /pty を代行）
      - GET    /api/pty-session              一覧（Engine GET /pty を代行）
      - POST   /api/pty-session/resize?id=    size 更新（Engine PUT /pty/:id を代行）
      - DELETE /api/pty-session?id=           終了（Engine DELETE /pty/:id を代行）
      - GET    /api/pty-session/stream?id=     SSE 出力ストリーム（Engine WS → BFF → ブラウザ）
      - POST   /api/pty-session/input?id=      入力送信（ブラウザ → BFF → Engine WS）
  → Engine PTY API（127.0.0.1、BFF からのみ到達）
```

- PTY 専用 API は `isBlockedOpencodeWrite()` を経由しない別ルートとして実装し、
  ルート内部で Engine の `pty.create` / `pty.update` / `pty.remove` / `pty.connectToken` を直接呼ぶ。
  汎用プロキシのブロックは変更しないため、既存の `/api/opencode/pty` 系リクエストは
  引き続き 403 のままになる。
- Next.js Route Handlers は HTTP Upgrade（WebSocket ハンドシェイク）を直接扱えないため、
  ブラウザ ⇄ BFF 間は **SSE 出力 + POST 入力**の擬似双方向で表現する。
  BFF ⇄ Engine 間は Node.js グローバル `WebSocket` で `/api/pty/{id}/connect` に接続し、
  フレームを相互中継する。
- ブラウザは Engine が発行する `ticket` を直接使わない。BFF が connect-token を発行し、
  サーバー間 WebSocket を開くだけに使う。

## API 契約

| API | 制限 | 入力 | レスポンス |
|-----|------|------|------------|
| `POST /api/pty-session` | host-only | `{ directory, cwd?, title? }` | `{ id, title, cwd, status }` |
| `GET /api/pty-session?directory=` | host-only | なし | `{ sessions: [{ id, title, cwd, status }] }` |
| `POST /api/pty-session/resize?id=` | host-only | `{ rows, cols }` | `{ ok: true }` |
| `DELETE /api/pty-session?id=` | host-only | なし | `{ ok: true }` |
| `GET /api/pty-session/stream?id=` | host-only | `?id=&directory=` | 出力: `text/event-stream` (`data: {t:"o",d:"..."}`) |
| `POST /api/pty-session/input?id=` | host-only | `{ data: string }` | `{ ok: true }` |

- `directory` は既存の `directoryHeaders` / `withDirectoryQuery` の慣例に従い、
  プロジェクトディレクトリのスコープ内であることを検証してから Engine へ渡す。
- `POST /api/pty-session` は `command` / `args` / `env` を受け取らない。
  任意実行可能ファイルの選択を防ぎ、Engine 既定シェルを使用する。
- host-only 判定は `remote-authz.md` の host-only API 定義と同じ実装
  （loopback 由来リクエストのみ許可、`X-Forwarded-*` を信頼しない）を再利用する。

## WebSocket/SSE 中継の要件

- BFF は `GET /api/pty-session/stream?id=` 接続時に、対象 `id` の PTY セッションが
  同一 BFF プロセスで既に作成されたものであることを検証する（他セッションの `id` を
  推測して繋がせない）。
- BFF ⇔ Engine 間の WebSocket は `ticket`（短命トークン）で 1 回だけ確立し、
  ブラウザ切断時は Engine 側 WebSocket も必ず close する。
- ブラウザ ⇄ BFF 間は SSE（長時間 `ReadableStream`）で PTY 出力を配信し、
  `POST /api/pty-session/input?id=` でキー入力を受け取る。
  SSE フレームは `data: {t:"o",d:"..."}` という JSON 形式で、改行やバイナリデータも
  テキスト安全に中継できる。
- resize は WebSocket フレームではなく `POST /api/pty-session/resize?id=` を使う
  （Engine の `pty.update` は HTTP PUT のため、専用チャンネルを分けない）。
  クライアント（`PtyPanel.tsx`）は xterm の `onResize` イベントでこのエンドポイントに
  `{ rows, cols }` を POST し、Engine PTY の内部サイズを同期する。
- 中継は UTF-8 テキストで行い、xterm.js 側でのエスケープシーケンス解釈に委ねる。
## UI 要件

- `PtyPanel.tsx` を拡張し、一覧表示に加えて「新規ターミナル」導線を追加する。
- ターミナル本体は xterm.js（または同等の pty-in-browser ライブラリ）を新規依存として導入する。
  未導入のため、依存追加は `package.json` 変更を伴い、`npm run test:encoding` 等の既存検証に影響しないことを確認する。
- レスポンシブ対応: モバイル/タブレット/PC の 3 viewport で、既存 composer との
  レイアウト競合（fixed 配置禁止・永続サイドバー/drawer 配置）を守る。
- 主要 UI 変更後は `ui-ux-reviewer` によるレビューを経る。

## セキュリティ考慮事項

- 対話ターミナルは任意コマンド実行と等価であるため、既定で host-only（loopback）限定にする。
  リモート公開は `remote-authz.md` の権限モデル拡張（例: `pty:use` 権限の新設）を
  別仕様として先に固めてから検討する。
- Engine の `ticket` をブラウザへ渡さない（上記アーキテクチャ参照）。
- PTY 作成時の `cwd` はプロジェクトディレクトリ配下に丸め込み、`../` 等での
  ディレクトリ脱出を拒否する（`remote-project-picker.md` の実装を参考にする）。
- 監査ログ（作成・終了・異常切断）は既存のログ永続化方針
  （`docs/specs/host-log-viewer.md`）に合わせて記録する。
- 将来的なリモート対応では、ブラウザ ⇄ BFF 間の SSE を認証プロキシ経由の
  `X-OCW-Auth-Assertion` + CSRF 境界の内側に置き、`remote-authz.md` の
  権限モデルに `pty:use` を追加してから開く。

## 段階的実装案

1. **Phase A**: host-only PTY 専用 API（作成・一覧・終了・resize）を実装し、
   検証（tsc/eslint/vitest）を通す。
2. **Phase B**: BFF 仲介 SSE/WS ストリーム（`stream` + `input`）を実装し、
   `PtyPanel.tsx` に xterm.js を統合。
3. **Phase C**: UI レビュー（`ui-ux-reviewer`）、E2E 検証、ドキュメント更新。
4. **Phase D（別仕様）**: リモート公開が必要になった場合のみ、`remote-authz.md` の
   権限モデルに `pty:use` 等を追加する仕様を別途起票する。

## オープン事項（承認前に確認したい論点）

1. 初期リリースを Phase A + B（host-only のみ）に限定し、リモート公開は明確に
   別仕様（Phase D）へ切り出す方針でよいか。
2. ブラウザ ⇄ BFF 間を SSE + POST 擬似双方向にし、カスタムサーバー導入を回避する設計でよいか。
3. `POST /api/pty-session` で `command` / `args` / `env` を完全拒否（Engine 既定シェルのみ）する方針でよいか。