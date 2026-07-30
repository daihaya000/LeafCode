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
      - POST   /api/pty-session            PTY 作成 + WS ticket 発行を一括代行
      - GET    /api/pty-session            一覧（既存 PtyPanel の GET /pty を置換 or 併用）
      - POST   /api/pty-session/:id/resize  size 更新（Engine PUT /pty/:id を代行）
      - DELETE /api/pty-session/:id         終了（Engine DELETE /pty/:id を代行）
      - WS     /api/pty-session/:id/stream  ブラウザ WebSocket ⇄ Engine WebSocket の中継
  → Engine PTY API（127.0.0.1、BFF からのみ到達）
```

- PTY 専用 API は `isBlockedOpencodeWrite()` を経由しない別ルートとして実装し、
  ルート内部で Engine の `pty.create` / `pty.update` / `pty.remove` / `pty.connectToken` を直接呼ぶ。
  汎用プロキシのブロックは変更しないため、既存の `/api/opencode/pty` 系リクエストは
  引き続き 403 のままになる。
- ブラウザは Engine が発行する `ticket` を直接使わず、BFF が仲介する WebSocket
  （`/api/pty-session/:id/stream`）にだけ接続する。Engine の `ticket` と WS URL は
  ブラウザに渡さない。BFF はサーバー間で `ticket` を使って Engine WebSocket を開き、
  フレームを相互中継する。
  - 理由: Engine の `ticket` がブラウザの JS に渡ると、XSS 等で盗まれた場合に
    Engine への直結を許してしまう。BFF 仲介にすることで、ブラウザ ⇔ BFF 間は
    同一オリジンの Cookie/セッション認証、BFF ⇔ Engine 間は loopback 限定にできる。

## API 契約

| API | 制限 | 入力 | レスポンス |
|-----|------|------|------------|
| `POST /api/pty-session` | host-only | `{ directory, command?, args?, cwd?, size?: { rows, cols } }` | `{ id, title }` |
| `GET /api/pty-session?directory=` | host-only | なし | `{ sessions: [{ id, title, size }] }` |
| `POST /api/pty-session/:id/resize` | host-only | `{ rows, cols }` | `{ ok: true }` |
| `DELETE /api/pty-session/:id` | host-only | なし | `{ ok: true }` |
| `WS /api/pty-session/:id/stream` | host-only | 入力: バイナリ/テキストフレーム（keystroke） | 出力: PTY 標準出力フレーム |

- `directory` は既存の `directoryHeaders` / `withDirectoryQuery` の慣例に従い、
  プロジェクトディレクトリのスコープ内であることを検証してから Engine へ渡す。
- `command` / `args` / `cwd` / `env` を未指定にした場合は Engine 既定シェルを使う。
  任意 `command` を許すかどうかは実装フェーズで確定する（既定は `pty.shells` の
  `acceptable: true` な候補のみ許可する案を優先）。
- host-only 判定は `remote-authz.md` の `host-only API` 定義と同じ実装
  （loopback 由来リクエストのみ許可、`X-Forwarded-*` を信頼しない）を再利用する。

## WebSocket 中継の要件

- BFF は `WS /api/pty-session/:id/stream` の接続確立時に、対象 `id` の PTY セッションが
  同一 BFF プロセスが直前に作成したものであることを検証する（他セッションの `id` を
  推測して繋がせない）。
- BFF ⇔ Engine 間の WebSocket は `ticket`（短命トークン）で 1 回だけ確立し、
  ブラウザ切断時は Engine 側 WebSocket も必ず close する。
- 中継はバイナリセーフに行い、フレームの分割・結合や文字コード変換をしない
  （xterm.js 側での UTF-8 デコードに委ねる）。
- resize は WebSocket フレームではなく `POST /api/pty-session/:id/resize` を使う
  （Engine の `pty.update` は HTTP PUT のため、専用チャンネルを分けない）。

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

## 段階的実装案

1. **Phase A**: host-only PTY 専用 API（作成・一覧・終了・resize）を実装し、
   WebSocket 中継なしで動作確認（curl / wscat 等での疎通確認）。
2. **Phase B**: BFF 仲介 WebSocket 中継を実装し、`PtyPanel.tsx` に xterm.js を統合。
3. **Phase C**: UI レビュー（`ui-ux-reviewer`）、E2E 検証、ドキュメント更新。
4. **Phase D（別仕様）**: リモート公開が必要になった場合のみ、`remote-authz.md` の
   権限モデルに `pty:use` 等を追加する仕様を別途起票する。

## オープン事項（承認前に確認したい論点）

1. 初期リリースを Phase A + B（host-only のみ）に限定し、リモート公開は明確に
   別仕様（Phase D）へ切り出す方針でよいか。
2. `command` を利用者が自由指定できるようにするか、`pty.shells` の
   `acceptable: true` 候補のみに絞るか（後者を既定案として提示）。
3. xterm.js 相当ライブラリの新規依存追加を許容するか（既存 `package.json` への影響）。
