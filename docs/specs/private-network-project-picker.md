# 単一利用者プライベートネットワークのプロジェクト選択

> 実装ステータス: ⬜ 未実装（計画・設計段階）

## 背景と決定

利用者は VPN/LAN を単独で利用し、通常の Caddy TLS サーバー証明書だけを使う。
TLS は通信を暗号化するが接続者を認証しないため、本モードは認証の代替ではない。
端末侵害、ネットワークへの誤接続、URL共有時には、許可ルート配下の名称・構成と
プロジェクト追加操作が第三者へ露出し得る。この残余リスクを利用者が明示的に受容する。

本仕様は認証なしの単一利用者専用モードを定義する。複数利用者、インターネット公開、
不特定の VPN/LAN 利用、または利用者を識別する必要がある場合は使わず、
`remote-authz.md` の認証モードを使う。

## 有効化条件

- 既定は無効。設定で `privateNetworkProjectPicker.enabled=true` を明示する。
- Caddy は TLS を終端し、BFF は従来どおり loopback のみで待ち受ける。BFF の
  `0.0.0.0` / LAN bind とこのモードの併用は禁止する。
- 接続元は `isLocalOrPrivateNetworkRequest` 相当で loopback または RFC 1918 / RFC 4193 /
  link-local の private address と確認できる場合だけ許可する。public address、欠落した
  proxy 情報、偽装可能な private header は拒否する。
- Caddy は外来の `Host` / `X-Forwarded-*` を受け渡さず、接続元を示す値を一貫して設定する。
  BFF は private network 判定を認証・所有者判定には使わない。
- 管理者は起動設定で 1 個以上の固定 `rootId`・表示名・実パスを登録する。UI や API で
  root を追加・変更できない。実パスは起動時に realpath 解決し、UNC、ドライブルート、
  システム領域、禁止領域を拒否する。
- 有効化時に残余リスクをログへ出す。設定不正、root 不在、BFF external bind、TLS 不使用は
  モードを無効化し remote API を `404` または `503` にする。

## API と UI

`remote-project-picker.md` の API 契約を使用する。

- `GET /api/remote-projects/roots`
- `GET /api/remote-projects/browse?rootId=&path=`
- `POST /api/remote-projects` JSON `{ rootId, path }`

各 API は private network 設定、有効な接続元、固定 root を検証する。`path` は root 相対、
空文字は root 自身で、絶対パス、`..`、UNC、制御文字を拒否する。レスポンス・エラー・
監査ログには絶対パスを含めない。

リモート UI はネイティブピッカーを呼ばず、固定 root とその直下だけを起点にした
「サーバー上のプロジェクトを追加」を表示する。手入力、ホーム、クイックアクセス、
既存 `/api/browse/dirs` の呼び出しは行わない。loopback の既存ネイティブ選択は変更しない。

## パスと監査

- 列挙と追加の直前に `path.resolve` と realpath の両方で固定 root 内を確認する。
  symlink / junction の逸脱を拒否する。
- 追加済み Project を利用する際も realpath を再検証する。TOCTOU は完全に排除できないため、
  検出時は拒否して記録する。
- API の成功・拒否・エラーは request ID、操作、rootId、root 相対パス、結果、理由、時刻を
  監査する。接続元情報は補助情報だけであり認可根拠にしない。
- 監査予約を書き込めなければ filesystem 操作前に fail closed する。結果監査に失敗した追加は
  ロールバックまたは後続アクセス不能な隔離状態にする。
- レート制限は rootId と接続元の検証済み情報をキーに列挙・追加を抑制する。これは DoS 緩和であり
  認証ではない。

## 非目標

- 利用者認証、ロール、複数利用者のデータ分離
- public IP、インターネット、共有 VPN/LAN からの利用
- 既存 host-only `/api/browse/dirs` / `/api/browse/folder` の緩和
- `allowed_roots` の自動公開

## 受入基準

1. 既定では API と UI が無効である。
2. 明示有効化、TLS、loopback BFF、固定 root、private/loopback 接続元のすべてを満たす場合だけ利用できる。
3. public・不明・偽装された接続元、BFF直結、設定不正では列挙・追加できない。
4. 固定 root 外、UNC、ドライブルート、システム領域、`..`、symlink逸脱は列挙・追加できない。
5. API・UI・監査は絶対パスと秘密情報を返さない。
6. loopback の既存ネイティブ選択および host-only API 制限は回帰しない。
7. 起動時と UI に、本モードが認証ではなく単一利用者の運用前提であることを明示する。
