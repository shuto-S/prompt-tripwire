import assert from "node:assert/strict";
import test from "node:test";

import { displayLabel, displayProductText, uiMessages } from "../../apps/ui/dist/web/i18n.js";

test("AC-015: Japanese UI messages cover state, category, trigger, and product templates", () => {
  const messages = uiMessages.ja;
  assert.equal(displayLabel(messages.states, "ready_for_approval"), "契約を承認できます");
  assert.equal(displayLabel(messages.categories, "persistent_data"), "永続データ");
  assert.equal(displayLabel(messages.triggers, "remote_write"), "リモート書き込み");
  assert.equal(
    displayProductText("Allow the proposed network access?", "ja"),
    "提案されたネットワークアクセスを許可しますか？",
  );
  assert.equal(displayProductText("Allow implementation only", "ja"), "実装のみ許可");
  assert.equal(
    displayProductText("a file path falls outside the approved contract", "ja"),
    "ファイルパスが承認済み契約の範囲外になった場合",
  );
  assert.equal(messages.decisionSources.observed_divergence, "独立プローブ間で観測された差分");
  assert.equal(messages.probeCount(3, 3), "3件中3件の独立計画プローブが有効");
  assert.equal(messages.optionSupport(2, 3), "3件中2件のプローブがこの選択肢を支持");
  assert.equal(messages.whatCodexMayChange, "Codexが変更できるもの");
  assert.equal(messages.whatMustPass, "成功が必須のチェック");
  assert.equal(messages.whatRemainsBlocked, "引き続き禁止されるもの");
});

test("localized chrome preserves arbitrary contract-bound source text", () => {
  const source = "Model-authored decision content must remain byte-for-byte unchanged.";
  assert.equal(displayProductText(source, "ja"), source);
  assert.equal(displayProductText(source, "en"), source);
});
