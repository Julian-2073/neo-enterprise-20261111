import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
const require = createRequire(import.meta.url);
const M = require("./model.cjs");
const dir = path.dirname(fileURLToPath(import.meta.url));
const step = (s, a, p) => M.transition(s, a, p);
function ready() {
  let s = step(M.seed(), "request-check");
  for (const key of ["staff", "room", "supply"]) s = step(s, "check", { key, value: true });
  for (const a of ["submit-check", "support", "publish", "accept", "receive", "train"]) s = step(s, a);
  return s;
}
function contacted() {
  return step(step(ready(), "contact", { ids: ["c1", "c2", "c6"], draft: "测试草稿" }), "responses");
}
function booked() {
  return step(step(contacted(), "book", { customerId: "c1", slot: "14:00" }), "book", { customerId: "c2", slot: "15:00" });
}
test("现场条件与总部决策不允许跳过", () => {
  assert.throws(() => step(M.seed(), "publish"), /核查/);
  assert.throws(() => step(M.seed(), "contact", { ids: ["c1"] }), /耗材/);
  let s = step(M.seed(), "request-check");
  assert.throws(() => step(s, "submit-check"), /三项/);
  for (const key of ["staff", "room", "supply"]) s = step(s, "check", { key, value: true });
  s = step(s, "submit-check");
  assert.throws(() => step(s, "publish"), /耗材/);
  s = step(step(step(s, "support"), "publish"), "accept");
  assert.equal(M.derived(s).canContact, false);
  assert.throws(() => step(s, "contact", { ids: ["c1"] }), /耗材/);
});
test("不合适的顾客不能联系，重复联系不增加记录", () => {
  let s = ready();
  for (const id of ["c3", "c4", "c5"]) assert.throws(() => step(s, "contact", { ids: [id] }), /名单/);
  s = step(s, "contact", { ids: ["c1", "c1"], draft: "明确保存的草稿" });
  assert.equal(s.contacted.length, 1);
  assert.equal(s.contactDraft, "明确保存的草稿");
  assert.deepEqual(step(s, "contact", { ids: ["c1"] }), s);
  assert.throws(() => step(s, "responses"), /3 位/);
});
test("拒绝预约冲突与未同意顾客，重复确认同一预约幂等", () => {
  let s = contacted();
  assert.throws(() => step(s, "book", { customerId: "c6", slot: "14:00" }), /同意/);
  assert.throws(() => step(s, "book", { customerId: "c1", slot: "18:00" }), /可用/);
  s = step(s, "book", { customerId: "c1", slot: "14:00" });
  assert.deepEqual(step(s, "book", { customerId: "c1", slot: "14:00" }), s);
  assert.throws(() => step(s, "book", { customerId: "c2", slot: "14:00" }), /已被预约/);
  assert.throws(() => step(s, "book", { customerId: "c1", slot: "15:00" }), /已有预约/);
});
test("预约、执行验收、服务观察与复盘分开记账", () => {
  let s = booked();
  assert.equal(M.derived(s).completed, 0);
  assert.equal(M.derived(s).serviceAmount, 0);
  assert.throws(() => step(s, "observe"), /验收/);
  assert.throws(() => step(s, "review", { decision: "小范围继续验证" }), /观察/);
  s = step(s, "submit-execution");
  assert.equal(s.executionAccepted, false);
  s = step(s, "accept-execution");
  assert.equal(M.derived(s).completed, 0);
  s = step(s, "observe");
  assert.deepEqual([M.derived(s).completed, M.derived(s).serviceAmount, M.derived(s).retail], [2, 536, 89]);
  s = step(s, "review", { decision: "小范围继续验证", note: "需要更多样本" });
  assert.equal(s.reviewed, true);
  assert.equal(s.events.at(-1).detail, "需要更多样本");
  assert.equal(s.bookings.some(b => b.customerId === "c3"), false);
});
test("重复下发与重复观察不制造记录，状态更新不修改原对象", () => {
  const initial = M.seed();
  const s = step(initial, "request-check");
  assert.equal(initial.checkRequested, false);
  assert.deepEqual(step(s, "request-check"), s);
  const r = ready();
  assert.deepEqual(step(r, "publish"), r);
  let o = step(step(step(booked(), "submit-execution"), "accept-execution"), "observe");
  assert.deepEqual(step(o, "observe"), o);
});

const html = fs.readFileSync(path.join(dir, "NEO直营门店协作原型.html"), "utf8");
function browser(saved) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: "http://localhost/prototype.html", runScripts: "dangerously", virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      if (saved) window.localStorage.setItem("neo-chain-service-prototype-v1", saved);
    },
  });
  return { dom, window: dom.window, document: dom.window.document, errors };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 12));
test("五个页面完整交互，保存后刷新可恢复复盘；重置回到起点", async () => {
  const b = browser();
  const click = async (action, extra = "") => {
    const el = b.document.querySelector(`button[data-action="${action}"]${extra}`);
    assert.ok(el, `找不到按钮 ${action} ${extra}`);
    assert.equal(el.disabled, false, `按钮被禁用 ${action}`);
    el.click(); await settle();
  };
  const navigate = async (route) => {
    b.window.location.hash = route; await settle();
    assert.ok(b.document.querySelector("h1"));
  };
  const state = () => JSON.parse(b.window.localStorage.getItem("neo-chain-service-prototype-v1"));
  assert.match(b.document.body.textContent, /全部为模拟数据/);
  await navigate("hq-issue");
  await click("request-check");
  await navigate("store-home");
  assert.match(b.document.body.textContent, /核实下午的人员/);
  await navigate("store-task");
  for (const key of ["staff", "room", "supply"]) {
    b.document.querySelector(`[data-check="${key}"]`).click(); await settle();
  }
  const note = "<script>window.hacked=true</script> 耗材不足";
  b.document.querySelector("#store-note").value = note;
  await click("submit-check");
  assert.equal(b.window.hacked, undefined);
  assert.ok(b.document.body.textContent.includes(note));
  await navigate("hq-issue");
  await click("issue-tab", '[data-tab="plan"]');
  await click("support");
  await click("publish");
  await navigate("store-task");
  await click("accept");
  await click("receive");
  await click("learning");
  await click("train");
  await navigate("customers");
  assert.equal(b.document.querySelector('[data-customer-check="c5"]').disabled, true);
  const search = b.document.querySelector("#customer-search");
  search.value = "林女士";search.dispatchEvent(new b.window.Event("input", { bubbles: true }));
  assert.equal(b.document.querySelectorAll("#customer-rows tr").length, 1);
  search.value = "";search.dispatchEvent(new b.window.Event("input", { bubbles: true }));
  await click("contact-preview");
  b.document.querySelector("#contact-draft").value = "已审核的模拟草稿";
  await click("contact");
  assert.equal(state().contactDraft, "已审核的模拟草稿");
  await click("responses");
  for (const id of ["c1", "c2"]) {
    await click("booking", `[data-id="${id}"]`);
    if (id === "c2") assert.equal(b.document.querySelector('input[name="booking-slot"][value="14:00"]').disabled, true);
    await click("book");
  }
  await navigate("store-task");
  await click("submit-execution");
  await navigate("hq-issue");
  await click("issue-tab", '[data-tab="execution"]');
  await click("accept-execution");
  assert.match(b.document.body.textContent, /实际到店/);
  assert.equal(state().outcomeReady, false);
  await click("observe");
  assert.match(b.document.body.textContent, /¥536/);
  assert.match(b.document.body.textContent, /¥89/);
  await click("review");
  assert.equal(state().reviewed, true);
  assert.match(b.document.body.textContent, /已保存的经营决定/);
  assert.deepEqual(b.errors, []);
  const restored = browser(b.window.localStorage.getItem("neo-chain-service-prototype-v1"));
  assert.match(restored.document.body.textContent, /已复盘/);
  restored.window.close();
  await click("reset");
  await click("confirm-reset");
  assert.equal(state().checkRequested, false);
  assert.equal(state().bookings.length, 0);
  assert.match(b.document.title, /总部今日经营/);
  b.window.close();
});
test("损坏的本地缓存可恢复，产物没有外部网络依赖", () => {
  const b = browser("{not valid json");
  assert.match(b.document.body.textContent, /保存进度/);
  assert.match(b.document.body.textContent, /发起|进入经营事项/);
  assert.deepEqual(b.errors, []);
  assert.equal(b.document.querySelectorAll("script[src],link[href],img[src^='http']").length, 0);
  assert.match(b.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src 'none'/);
  b.window.close();
});
