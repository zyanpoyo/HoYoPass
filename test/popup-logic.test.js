import test from 'node:test';
import assert from 'node:assert/strict';
import { isLogForGame, buildLatestLogSummary, stripGamePrefix } from '../src/popup/log-view.js';
import { setupCheckboxMinimumValidation } from '../src/popup/modals.js';

test('isLogForGame: gameKey プロパティ優先判定とレガシー文字列フォールバック', () => {
  assert.equal(isLogForGame(null, 'GENSHIN'), false);

  // 構造化 gameKey 指定あり
  assert.equal(isLogForGame({ gameKey: 'GENSHIN', message: '任意メッセージ' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ gameKey: 'STAR_RAIL', message: '原神という文字があっても別キー' }, 'GENSHIN'), false);

  // gameKey なし・ゲーム名含有時
  assert.equal(isLogForGame({ message: '原神: 引き換え完了' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: 'Genshin Impact: Finished redeeming' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: '崩壊：スターレイル: 引き換え完了' }, 'GENSHIN'), false);

  // どのゲーム名も含まない共通システムログ（全タブに表示）
  assert.equal(isLogForGame({ message: '一時的な通信不通を検知したため、2分後に自動再試行します' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: '一時的な通信不通を検知したため、2分後に自動再試行します' }, 'ZZZ'), true);
});

test('buildLatestLogSummary: 最新ログの種別と日英サマリー生成', () => {
  const emptyJa = buildLatestLogSummary(null, 'ja');
  assert.equal(emptyJa.text, '直近のログ: 履歴なし');
  assert.equal(emptyJa.isError, false);

  const emptyEn = buildLatestLogSummary(undefined, 'en');
  assert.equal(emptyEn.text, 'Latest: No logs');
  assert.equal(emptyEn.isError, false);

  const ts = new Date(2026, 9, 25, 14, 5, 0).getTime();

  const errSummary = buildLatestLogSummary({ type: 'ERROR', timestamp: ts }, 'ja');
  assert.equal(errSummary.text, '直近のログ: エラー (10/25 14:05)');
  assert.equal(errSummary.isError, true);

  const warnSummary = buildLatestLogSummary({ type: 'WARN', timestamp: ts }, 'en');
  assert.equal(warnSummary.text, 'Latest: Warning (10/25 14:05)');
  assert.equal(warnSummary.isError, false);

  const okSummary = buildLatestLogSummary({ type: 'INFO', timestamp: ts }, 'ja');
  assert.equal(okSummary.text, '直近のログ: 正常完了 (10/25 14:05)');
  assert.equal(okSummary.isError, false);
});

test('stripGamePrefix: 日本語・英語ゲーム名プレフィックスの除去', () => {
  assert.equal(
    stripGamePrefix('原神: 引き換え完了 (新規成功: 2件)', 'GENSHIN'),
    '引き換え完了 (新規成功: 2件)'
  );
  assert.equal(
    stripGamePrefix('Genshin Impact: Finished redeeming (2 new succeeded)', 'GENSHIN'),
    'Finished redeeming (2 new succeeded)'
  );
  assert.equal(
    stripGamePrefix('共通システムメッセージ', 'GENSHIN'),
    '共通システムメッセージ'
  );
});

test('setupCheckboxMinimumValidation: 最後の1つのチェックボックスが disabled になること', () => {
  const createMockCb = (checked) => {
    const listeners = [];
    return {
      checked,
      disabled: false,
      addEventListener: (ev, fn) => {
        if (ev === 'change') listeners.push(fn);
      },
      triggerChange: () => listeners.forEach(fn => fn())
    };
  };

  const cb1 = createMockCb(true);
  const cb2 = createMockCb(true);
  const cb3 = createMockCb(false);

  setupCheckboxMinimumValidation([cb1, cb2, cb3]);

  // 2つチェック時はすべて操作可能
  assert.equal(cb1.disabled, false);
  assert.equal(cb2.disabled, false);
  assert.equal(cb3.disabled, false);

  // cb2 のチェックを外して残り1つ(cb1のみ)にすると cb1 が disabled になる
  cb2.checked = false;
  cb2.triggerChange();
  assert.equal(cb1.disabled, true);
  assert.equal(cb2.disabled, false);

  // cb3 にチェックを入れて2つに戻すと disabled 解除
  cb3.checked = true;
  cb3.triggerChange();
  assert.equal(cb1.disabled, false);
  assert.equal(cb3.disabled, false);
});
