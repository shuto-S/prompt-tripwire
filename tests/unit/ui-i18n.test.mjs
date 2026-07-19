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
});

test("localized chrome preserves arbitrary contract-bound source text", () => {
  const source = "Model-authored decision content must remain byte-for-byte unchanged.";
  assert.equal(displayProductText(source, "ja"), source);
  assert.equal(displayProductText(source, "en"), source);
});
