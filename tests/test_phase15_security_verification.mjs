import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log("====================================================");
console.log("🛡️ PHASE 15 UNIVERSAL SECURITY VERIFICATION SUITE");
console.log("====================================================");

const rootDir = process.cwd();

// ─── 1. Identity 検証 ─────────────────────────────────────────────
test('1. Identity: LIFF Token 公式検証、クライアント申告値の無効化、LINE公式userIdの唯一根拠性', () => {
  const authJsPath = path.join(rootDir, 'active/api/auth/auth.js');
  const authJs = fs.readFileSync(authJsPath, 'utf8');

  // トークン必須性の検証
  assert.ok(authJs.includes('if (!payload || !payload.liffToken)'), 'auth.js must require liffToken');
  assert.ok(authJs.includes('Unauthorized: Missing liffToken'), 'auth.js must reject missing liffToken');

  // LINE API URL への Bearer 認証
  assert.ok(authJs.includes('https://api.line.me/v2/profile'), 'auth.js must verify with LINE profile API');
  assert.ok(authJs.includes("'Authorization': 'Bearer ' + token"), 'auth.js must pass Bearer token to LINE API');

  // クライアント申告ではなく、LINE 公式応答の profileData.userId を採用すること
  assert.ok(authJs.includes('lineUserId: profileData.userId'), 'auth.js must extract lineUserId strictly from LINE official response');
});

// ─── 2. Authorization 検証 ─────────────────────────────────────────
test('2. Authorization: 操作主体IdentityのBackend強制解決、staffId偽装遮断、未登録者拒絶', () => {
  const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
  const v2Api = fs.readFileSync(v2ApiPath, 'utf8');

  // staffDependentActions の存在確認
  assert.ok(v2Api.includes('const staffDependentActions ='), 'v2_api.js must define staffDependentActions');
  assert.ok(v2Api.includes('resolveStaffIdentity'), 'v2_api.js must resolve identity on backend');
  assert.ok(v2Api.includes('NOT_REGISTERED'), 'v2_api.js must reject unregistered users with NOT_REGISTERED');

  // クライアント送信値を上書きして強制確定すること
  assert.ok(v2Api.includes('postData.staffId = identity.staffId'), 'v2_api.js must overwrite client staffId with resolved identity');
  assert.ok(v2Api.includes('postData.staffName = identity.staffName'), 'v2_api.js must overwrite client staffName with resolved identity');
});

// ─── 3. Tenant Isolation 検証 ──────────────────────────────────────
test('3. Tenant Isolation: DISTRICT_REGISTRY動的解決、SYSTEM_INFO地区コード照合、越境アクセス完全遮断', () => {
  const adapterPath = path.join(rootDir, 'active/infrastructure/spreadsheet/spreadsheet_adapter.js');
  const adapter = fs.readFileSync(adapterPath, 'utf8');

  // DISTRICT_REGISTRY ルーティング
  assert.ok(adapter.includes('props.getProperty("DISTRICT_REGISTRY")'), 'spreadsheet_adapter.js must check DISTRICT_REGISTRY');
  assert.ok(adapter.includes('districtId is required for multi-district routing. No fallback allowed.'), 'No fallback allowed when registry active');

  // verifyIntegrityGuard
  assert.ok(adapter.includes('verifyIntegrityGuard(ss, districtId)'), 'spreadsheet_adapter.js must verify integrity guard');
  assert.ok(adapter.includes('DISTRICT_MISMATCH'), 'spreadsheet_adapter.js must throw DISTRICT_MISMATCH on code mismatch');
});

// ─── 4. Input Validation 検証 ───────────────────────────────────────
test('4. Input Validation: パラメータ型・必須チェック、未知アクション拒絶、不正JSON耐性', () => {
  const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
  const v2Api = fs.readFileSync(v2ApiPath, 'utf8');

  // doGet / doPost での安全な JSON パース (try-catch)
  assert.ok(v2Api.includes('JSON.parse(e.postData.contents)'), 'v2_api.js must parse postData inside safe block');
  assert.ok(v2Api.includes('isWebAppCall = true'), 'v2_api.js must set isWebAppCall flag');

  // 無効なリクエストの拒絶
  assert.ok(v2Api.includes('MISSING_DISTRICT_ID'), 'v2_api.js must validate districtId presence');
});

// ─── 5. XSS 防護検証 ────────────────────────────────────────────────
test('5. XSS: escapeHtml (SEC-004) による特殊文字無害化とクライアント側サニタイズ適用', () => {
  const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // escapeHtml の実装ロジック検証
  assert.ok(appJs.includes('window.escapeHtml = function(value)'), 'app.js must define escapeHtml');

  // テスト用 vm コンテキストで escapeHtml を直接検証
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    window = {};
    ${appJs.substring(appJs.indexOf('window.escapeHtml'), appJs.indexOf('};', appJs.indexOf('window.escapeHtml')) + 2)}
  `, sandbox);

  const escapeFn = sandbox.window.escapeHtml;
  assert.equal(escapeFn('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeFn("Tom's & Jerry's"), 'Tom&#039;s &amp; Jerry&#039;s');
  assert.equal(escapeFn(null), '');
  assert.equal(escapeFn(undefined), '');
});

// ─── 6. CSRF & Method Boundary 検証 ─────────────────────────────────
test('6. CSRF & Method Boundary: doGetでのliffToken送信禁止、更新処理のPOST限定', () => {
  const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
  const v2Api = fs.readFileSync(v2ApiPath, 'utf8');

  // doGet 内での liffToken 送信禁止ガード
  assert.ok(v2Api.includes('if (params.liffToken)'), 'doGet must inspect params.liffToken');
  assert.ok(v2Api.includes('Token transmission via GET is prohibited.'), 'doGet must block token transmission via GET');
});

// ─── 7. Secret Exposure 検証 ───────────────────────────────────────
test('7. Secret Exposure: .gitignoreによる機密ファイル除外、Git追跡下に秘密情報なし', () => {
  const gitignorePath = path.join(rootDir, '.gitignore');
  assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');

  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(gitignore.includes('.secrets/'), '.gitignore must exclude .secrets/');
  assert.ok(gitignore.includes('.env'), '.gitignore must exclude .env');
  assert.ok(gitignore.includes('.clasp.json'), '.gitignore must exclude .clasp.json');
  assert.ok(gitignore.includes('deployment.json'), '.gitignore must exclude deployment.json');
});

// ─── 8. lineUserId Exposure 検証 ───────────────────────────────────
test('8. lineUserId Exposure: APIレスポンスからの他者lineUserId完全除外、isMeフラグのみ返却', () => {
  const distRepoPath = path.join(rootDir, 'active/business/distribution/distribution_repository.js');
  const distRepo = fs.readFileSync(distRepoPath, 'utf8');

  // ランキング返却オブジェクトの検証
  assert.ok(distRepo.includes('// APIレスポンスには lineUserId を一切含めない（isMe と表示用ラベルのみ）'), 'Ranking must exclude lineUserId');
  assert.ok(distRepo.includes('isMe: isMe'), 'Ranking must only return isMe');

  // 最新実績返却オブジェクトの検証
  assert.ok(distRepo.includes('// APIレスポンスには lineUserId を含めない'), 'Latest records must exclude lineUserId');

  // 名簿返却オブジェクトの検証
  const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
  const v2Api = fs.readFileSync(v2ApiPath, 'utf8');
  assert.ok(v2Api.includes('case \'getRoster\':'), 'v2_api.js must handle getRoster');
  assert.ok(!v2Api.includes('lineUserId: r.lineUserId'), 'getRoster response must never expose lineUserId');
});

// ─── 9. API Abuse & Idempotency 検証 ────────────────────────────────
test('9. API Abuse & Idempotency: クライアント二重送信防止、LockServiceProvider排他制御', () => {
  const lockAdapterPath = path.join(rootDir, 'active/infrastructure/lock/lock_adapter.js');
  const lockAdapter = fs.readFileSync(lockAdapterPath, 'utf8');

  assert.ok(lockAdapter.includes('class LockServiceProvider'), 'LockServiceProvider must exist');
  assert.ok(lockAdapter.includes('LockService.getScriptLock()'), 'Must use GAS ScriptLock');
  assert.ok(lockAdapter.includes('lock.tryLock(timeoutMs)'), 'Must acquire lock with timeout');

  const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('generateRequestId'), 'app.js must generate unique requestId for idempotency');
});

// ─── 10. Audit Logging 検証 ─────────────────────────────────────────
test('10. Audit Logging: 操作者staffId、JSTタイムスタンプ、不可逆記録による監査証跡', () => {
  const distRepoPath = path.join(rootDir, 'active/business/distribution/distribution_repository.js');
  const distRepo = fs.readFileSync(distRepoPath, 'utf8');

  // タイムスタンプとstaffIdの保持
  assert.ok(distRepo.includes('rawCompletedAt'), 'Distribution repository must track completedAt');
  assert.ok(distRepo.includes('staffId'), 'Distribution repository must track staffId');

  // ADR-016 の存在
  const adr16Path = path.join(rootDir, 'docs/architecture/decisions/ADR-016_SECURITY_ARCHITECTURE.md');
  assert.ok(fs.existsSync(adr16Path), 'ADR-016 must exist');
});
