# Legacy & Quarantined Tests (非推奨・隔離テスト群)

本ディレクトリに配置されているテストファイルは、Universal POSTING MAP の現行テストスイートから正式に隔離・除外されたレガシーファイルです。

## 隔離対象ファイル一覧と理由

1. **`test_bulletin_lifecycle.mjs`**
   - **隔離理由**: Phase 12 において「掲示板（Bulletin）機能」は Universal Engine のコア設計スコープ外として正式に除外・削除されました。本テストは削除された旧掲示板 API・DOM 構造を前提としているため実行不能（モック解決不能による例外）となっており、現役テストスイートから隔離されています。

2. **`dashboard_verification_gate.mjs`**
   - **隔離理由**: 外部 npm パッケージ `playwright` に依存しています。Universal POSTING MAP は「外部依存ゼロ（Node.js ネイティブ標準ライブラリおよび OS ネイティブ Google Chrome CDP）」を標準アーキテクチャとして採用しており、`node_modules` を含まない環境で `MODULE_NOT_FOUND` となるため隔離されています。

3. **`test_initial_display_sync.mjs`**
   - **隔離理由**: 同様に外部 npm パッケージ `playwright` に依存しており、標準実行環境では動作不能であるため隔離されています。実ブラウザでの描画・表示同期の検証は `tests/measure_chrome_real.mjs`（Chrome CDP 直接通信）によって正式に代替されています。

---
※ これらのファイルは歴史的経緯および参照用として保持されていますが、CI/CD・日常の回帰テスト実行対象には含まれません。
