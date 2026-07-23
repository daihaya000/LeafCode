# MEMORY

## 2026-07-23: CodexBar addon の Qwen Cloud アイコン

### やったこと
- Qwen Code公式のApache-2.0 PNGをCodexBar addonに追加し、`qwen-cloud` と `qwen` のブランド表示・アイコン解決を対応した。
- ブランドキーとOpenCodeプロバイダIDからのアイコン解決をテストした。

### 判断理由
- OpenCodeの既存設定が使用する `qwen-cloud` を主IDとし、互換性のため `qwen` も同じQwen Cloudアイコンへ解決する。
- addonの公開資産は `addons/codexbar/public/` を正とし、`sync:addons` でWeb公開先へ同期する。

### 教訓
- addonのプロバイダ追加は、ラベル・アイコンマップ・OpenCode ID変換・公開PNG・ユニットテストを同じ変更単位で更新する。
