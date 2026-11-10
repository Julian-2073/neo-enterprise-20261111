import assert from "node:assert/strict";
import test from "node:test";

async function request(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const pages = [
  ["/demo?mode=example", "意向增长，成交承接走弱", /1,260,000/],
  ["/demo?mode=example&page=people", "意向在增长，成交没跟上", /12\.5%/],
  ["/demo?mode=example&page=goods", "货要配得上需求，也要撑起品牌", /72\.2%/],
  ["/demo?mode=example&page=market", "同样的货，在不同场里机会不同", /210,000/],
  ["/demo?mode=example&page=overview", "意向在增长，成交没跟上", /三域经营脉搏/],
  ["/demo?mode=example&page=weekly", "本周行动周报", /48小时供给核查/],
];

for (const [path, heading, detail] of pages) {
  test(`server-renders the NEO prototype page ${path}`, async () => {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /NEO · 增长决策工作台/);
    assert.match(html, /模拟数据/);
    assert.match(html, /COCA健身/);
    assert.doesNotMatch(html, /家用健身/);
    assert.match(html, /今日经营/);
    assert.match(html, /我的客户/);
    assert.match(html, /供应链与库存/);
    assert.match(html, /渠道与竞品/);
    assert.match(html, /生意预测\/协同/);
    assert.match(html, new RegExp(heading));
    assert.match(html, detail);
    assert.match(html, /不连接真实经营系统/);
    // Empty SVG titles caused client hydration to disagree with server output.
    assert.doesNotMatch(html, /<title><\/title>/);
  });
}

test("renders the combined decision workflow with its initial evidence context", async () => {
  const response = await request("/demo?mode=example&page=overview");
  const html = await response.text();
  assert.match(html, /经营联动/);
  assert.match(html, /预测推演/);
  assert.match(html, /行动决策/);
  assert.match(html, /58,000/);
  assert.match(html, /生成联动核查清单/);
});

test("home decision desk connects diagnosis, scoped outlook, action and evidence", async () => {
  const response = await request("/demo?mode=example");
  const html = await response.text();
  assert.match(html, /role="dialog"[^>]*aria-labelledby="today-brief-title"/);
  assert.match(html, /今日经营简报/);
  assert.match(html, /经营决策/);
  assert.match(html, /如果维持现状/);
  assert.match(html, /105–135/);
  assert.match(html, /48 小时供给核查/);
  assert.match(html, /增长智能体/);
  assert.doesNotMatch(html, /<h2>市场机会<\/h2>/);
});

test("daily briefing is confined to the home entry page", async () => {
  const response = await request("/demo?mode=example&page=people");
  const html = await response.text();
  assert.doesNotMatch(html, /aria-labelledby="today-brief-title"/);
});

test("legacy forecast route redirects into the combined collaboration page", async () => {
  const response = await request("/future");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/analysis\/overview/);
});

for (const path of ["/demo", "/", "/analysis/people", "/analysis/goods", "/analysis/market", "/analysis/overview", "/reports/weekly", "/data/imports", "/data/ontology"]) {
  test(`business page ${path} contains no demo facts`, async () => {
    const response = await request(path); assert.equal(response.status,200);
    const html = await response.text(); assert.doesNotMatch(html,/COCA健身|105–135|72\.2%|12\.5%/);assert.match(html,path==="/data/imports"?/数据导入/:path==="/data/ontology"?/数据与智能中台/:/neo-topbar/);
  });
}
test("legacy anonymous data route is disabled", async () => {
 const response = await request("/api/data"); assert.equal(response.status,410);
});
