# Ollama Icon Normalization Implementation Plan

# Ollama Icon Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ollama ブランドアイコンを 180×180 px 正方形・背景色 `#DFE5E8` 塗りつぶしに変換し、2 箇所のアセットファイルを同一内容で置き換える。

**Architecture:** 画像処理は PowerShell (System.Drawing / .NET Imaging) で行う。Python や Node.js の追加パッケージインストールは不要。変換とコピーを同一コミットにまとめる。

**Tech Stack:** PowerShell (.NET Imaging)、certutil / fc によるバイナリ検証、Git

## Global Constraints

- キャンバスサイズ: 180×180 px（他アイコンと同一）
- 背景色: `#DFE5E8`（RGB: 223, 229, 232）、完全不透過（alpha 255）
- ロゴ配置: 180×180 の背景上にアスペクト比を維持して中央配置。ロゴ全体がクリップされないよう、長辺がキャンバス内側パディング（片側 12 px）の内側に収まるようスケール
- 内側パディング: 12 px（コンテンツ領域 156×156 px）
- ファイル形式: PNG（ファイル名 `ollama.png` 変更なし）
- コード変更禁止（`.tsx`, `.ts`, `.test.ts` 等は一切編集しない）
- 新規テスト追加なし（既存テストはパス検証のみで画素検査しない）
- 両ファイルの SHA-256 が一致すること
- 変換スクリプトは入力ファイルを直接読書きせず、メモリ読み込み＋一時ファイル出力＋安全な原子置換で行う

---

### Task 1: 画像変換・コピー・検証・コミット

**Files:**
- Modify: `addons/codexbar/public/ollama.png`（変換後、安全に置換）
- Modify: `web/public/addons/codexbar/ollama.png`（変換後ファイルをコピー）

**Interfaces:**
- 変換元: 現行 `addons/codexbar/public/ollama.png`（181×256 px、RGBA 透過）
- 変換後: 180×180 px、背景 `#DFE5E8` 塗りつぶし、ロゴ全体を内側パディング 12 px の内側に収めて中央配置

**注意:** このタスクは変換とコピーを同一意味単位として 1 コミットにまとめる。変更→検証→即コミットの原則に従う。

- [ ] **Step 1: 変換前の SHA-256 を記録する**

```powershell
certutil -hashfile addons\codexbar\public\ollama.png SHA256
certutil -hashfile web\public\addons\codexbar\ollama.png SHA256
```

Expected: 両ファイルとも `5c5528504c307d34af504f39bc4e7007d2f6f31ee00dab699cc91584d1af8aca`（現行の透過縦長画像）。

- [ ] **Step 2: PowerShell で変換スクリプトを実行する**

以下のスクリプトは入力ファイルをメモリに読み込み、一時ファイルに出力し、安全に元パスへ置換する。

```powershell
Add-Type -AssemblyName System.Drawing

$src = "addons\codexbar\public\ollama.png"
$size = 180
$padding = 12
$contentSize = $size - 2 * $padding  # 156
$bgColor = [System.Drawing.Color]::FromArgb(255, 223, 229, 232)

# メモリ読み込み
$srcImg = [System.Drawing.Image]::FromFile($src)

# 長辺が contentSize に収まるようスケール（アスペクト比維持、ロゴ全体保持）
$longer = [Math]::Max($srcImg.Width, $srcImg.Height)
$scale = $contentSize / $longer
$w = [int][Math]::Round($srcImg.Width * $scale)
$h = [int][Math]::Round($srcImg.Height * $scale)

# 背景キャンバスに描画
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear($bgColor)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($srcImg, $padding + [Math]::Round(($contentSize - $w) / 2), $padding + [Math]::Round(($contentSize - $h) / 2), $w, $h)
$g.Dispose()
$srcImg.Dispose()

# 一時ファイルに出力 → 安全に原子置換
$tmp = [System.IO.Path]::GetTempFileName() + ".png"
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Move-Item -Path $tmp -Destination $src -Force
Write-Host "Written $src (${w}x${h} logo on ${size}x${size} canvas)"
```

Expected: スクリプトが正常終了し、`addons/codexbar/public/ollama.png` が安全に置換される。

- [ ] **Step 3: 変換後の画像を検証する**

```powershell
# サイズ確認
$img = [System.Drawing.Image]::FromFile("addons\codexbar\public\ollama.png")
Write-Host "Width: $($img.Width) Height: $($img.Height)"
$img.Dispose()
```

Expected: `Width: 180 Height: 180`

```powershell
# 背景色確認（左上隅ピクセル）
$bmp = [System.Drawing.Bitmap]::FromFile("addons\codexbar\public\ollama.png")
$px = $bmp.GetPixel(0, 0)
Write-Host "Pixel(0,0): R=$($px.R) G=$($px.G) B=$($px.B) A=$($px.A)"
$bmp.Dispose()
```

Expected: `Pixel(0,0): R=223 G=229 B=232 A=255`

```powershell
# 中央付近にロゴ（非背景色）が存在することを確認
$bmp = [System.Drawing.Bitmap]::FromFile("addons\codexbar\public\ollama.png")
$hasContent = $false
for ($x = 0; $x -lt 180; $x++) {
  for ($y = 0; $y -lt 180; $y++) {
    $px = $bmp.GetPixel($x, $y)
    if ($px.R -ne 223 -or $px.G -ne 229 -or $px.B -ne 232) { $hasContent = $true; break }
  }
  if ($hasContent) { break }
}
Write-Host "Has non-background content: $hasContent"
$bmp.Dispose()
```

Expected: `Has non-background content: True`

- [ ] **Step 4: コピー先ファイルを同期する**

```bash
copy /Y addons\codexbar\public\ollama.png web\public\addons\codexbar\ollama.png
```

Expected: 1 file(s) copied.

- [ ] **Step 5: 両ファイルの SHA-256 が一致することを確認する**

```powershell
certutil -hashfile addons\codexbar\public\ollama.png SHA256
certutil -hashfile web\public\addons\codexbar\ollama.png SHA256
```

Expected: 両方のハッシュ値が完全一致すること。現行の `5c552850...` とは異なる新しいハッシュ値になる。

- [ ] **Step 6: バイト単位の一致も確認する（念のため）**

```bash
fc /B addons\codexbar\public\ollama.png web\public\addons\codexbar\ollama.png
```

Expected: `FC: 相違点は見つかりませんでした`（日本語環境）または `FC: no differences encountered`。

- [ ] **Step 7: 既存テストがパスすることを確認する**

```bash
cd web && npx vitest run src/components/task/ProviderIcon.test.tsx
```

Expected: 全テスト PASS（アセットパス不変のため）。

- [ ] **Step 8: typecheck と lint がパスすることを確認する**

```bash
cd web && npm run typecheck && npm run lint
```

Expected: 両方ともエラーなし（コード変更がないため）。

- [ ] **Step 9: git status と git diff で意図した差分のみ含まれることを確認する**

```bash
git status
git diff --stat
```

Expected:
- `git status`: `addons/codexbar/public/ollama.png` と `web/public/addons/codexbar/ollama.png` のみ modified
- `git diff --stat`: 2 files changed（バイナリファイルのため行数表示なし）
- コードファイル（`.tsx`, `.ts`, `.test.ts` 等）の差分が混ざっていないこと

- [ ] **Step 10: コミットする**

```bash
git add addons/codexbar/public/ollama.png web/public/addons/codexbar/ollama.png
git commit -m "chore: ollama ブランドアイコンを 180×180 正方形・背景色 #DFE5E8 に正規化"
```

Expected: 2 ファイル staged、1 コミット成功。

---

### 検証まとめ（全タスク完了後）

```bash
# 1. 画像サイズ
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("addons\codexbar\public\ollama.png")
Write-Host "Size: $($img.Width)x$($img.Height)"
$img.Dispose()

# 2. 背景色
$bmp = [System.Drawing.Bitmap]::FromFile("addons\codexbar\public\ollama.png")
$px = $bmp.GetPixel(0,0)
Write-Host "BG: R=$($px.R) G=$($px.G) B=$($px.B) A=$($px.A)"
$bmp.Dispose()

# 3. バイト一致
fc /B addons\codexbar\public\ollama.png web\public\addons\codexbar\ollama.png

# 4. テスト
cd web && npx vitest run src/components/task/ProviderIcon.test.tsx

# 5. typecheck + lint
cd web && npm run typecheck && npm run lint

# 6. git 状態
git status
git log --oneline -3
```

Expected: 全項目が仕様通りであること。
