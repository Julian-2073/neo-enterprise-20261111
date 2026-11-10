(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NeoModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 1;
  const customers = [
    { id: "c1", name: "林女士", initials: "林", color: "blue", owner: "小林", last: "10月02日", preference: "工作日下午方便", note: "上次咨询过工作日下午的护理时段，希望下次提前确认。", status: "适合跟进", eligible: true, response: "同意预约", slot: "14:00", history: "10.02 完成头皮清洁护理 · 09.10 购买日常洗护", card: "次卡剩余 0 次", phone: "模拟顾客 C001" },
    { id: "c2", name: "陈女士", initials: "陈", color: "teal", owner: "小林", last: "09月22日", preference: "偏好 15:00 后到店", note: "近期有明确护理咨询，尚未确定到店时间。", status: "适合跟进", eligible: true, response: "同意预约", slot: "15:00", history: "10.19 咨询可预约时段 · 09.22 完成头皮清洁护理", card: "普通会员", phone: "模拟顾客 C002" },
    { id: "c3", name: "周女士", initials: "周", color: "purple", owner: "小雨", last: "10月06日", preference: "已预约晚间时段", note: "已有 10月21日 17:30 的预约，不重复邀约，也不把改约计作新增。", status: "已有预约", eligible: false, history: "10.18 已确认 10.21 17:30 的预约", card: "次卡剩余 2 次", phone: "模拟顾客 C003" },
    { id: "c4", name: "许女士", initials: "许", color: "amber", owner: "小雨", last: "10月11日", preference: "近期已跟进", note: "10月19日已由小雨联系，正在等顾客回复。", status: "避免重复联系", eligible: false, history: "10.19 已联系，等待回复 · 10.11 完成护理", card: "普通会员", phone: "模拟顾客 C004" },
    { id: "c5", name: "赵女士", initials: "赵", color: "slate", owner: "小林", last: "09月18日", preference: "不接收营销联系", note: "顾客明确不接收营销联系，本次不进入联系名单。", status: "请勿联系", eligible: false, history: "09.18 记录联系偏好：不接收营销联系", card: "普通会员", phone: "模拟顾客 C005" },
    { id: "c6", name: "何女士", initials: "何", color: "rose", owner: "小林", last: "09月28日", preference: "有需求，时间待确认", note: "上次离店时希望有合适时段再联系，当前没有预约。", status: "适合跟进", eligible: true, response: "这次暂不预约", history: "09.28 完成护理，并记录后续联系意愿", card: "普通会员", phone: "模拟顾客 C006" },
  ];
  const slots = ["14:00", "15:00"];
  function seed() {
    return {
      version: VERSION, checkRequested: false, checks: { staff: false, room: false, supply: false },
      checked: false, supportArranged: false, published: false, accepted: false,
      supportReceived: false, trained: false, contacted: [], responses: false, bookings: [],
      executionSubmitted: false, executionAccepted: false, outcomeReady: false, reviewed: false,
      decision: "", reviewNote: "", storeNote: "", contactDraft: "", events: [
        { id: 0, actor: "总部 Agent", title: "发现时段供需不匹配", detail: "湖滨店下午预约占用率 42%，晚间 90%。建议先核查接待条件。", time: "10.20 09:00" },
      ],
    };
  }
  function derived(s) {
    const stage = s.reviewed ? 5 : s.executionAccepted ? 4 : s.published ? 3 : s.checked ? 2 : s.checkRequested ? 1 : 0;
    const completed = s.outcomeReady ? s.bookings.length : 0;
    const retail = s.outcomeReady && s.bookings.some(b => b.customerId === "c1") ? 89 : 0;
    return { stage, completed, serviceAmount: completed * 268, retail, full: s.bookings.length === 2,
      canContact: s.accepted && s.supportReceived && s.trained && !s.executionSubmitted,
      canSubmit: s.accepted && s.supportReceived && s.trained && s.responses && s.bookings.length === 2 && !s.executionSubmitted };
  }
  function transition(previous, action, payload = {}) {
    const s = JSON.parse(JSON.stringify(previous));
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    const log = (actor, title, detail) => {
      const i = s.events.length;
      const minutes = 5 * i;
      const date = s.outcomeReady ? "10.21" : "10.20";
      s.events.push({ id: i, actor, title, detail, time: `${date} ${String((s.outcomeReady ? 16 : 9) + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` });
    };
    switch (action) {
      case "request-check":
        if (s.checkRequested) return s;
        s.checkRequested = true;
        log("总部负责人 · 王宁", "发起湖滨店现场核查", "核对人员技能、护理间与耗材；不直接下发顾客邀约。");
        break;
      case "check":
        require(s.checkRequested && !s.checked, "请先由总部发起核查。");
        require(["staff", "room", "supply"].includes(payload.key), "未知核查项。");
        s.checks[payload.key] = !!payload.value;
        break;
      case "submit-check":
        if (s.checked) return s;
        require(s.checkRequested && Object.values(s.checks).every(Boolean), "请完成三项现场核查。");
        s.checked = true;
        s.storeNote = String(payload.note || "小林与 A 护理间可用；护理耗材需补充 2 份。").slice(0, 600);
        log("门店 Agent · 店长确认", "提交核查结果，并申请耗材支持", s.storeNote);
        break;
      case "support":
        if (s.supportArranged) return s;
        require(s.checked, "先等待门店核查结果。");
        s.supportArranged = true;
        log("总部运营 · 王宁", "安排补充 2 份护理耗材", "配送负责人：陈敏；计划今日 13:00 前到位。尚待门店确认收到。");
        break;
      case "publish":
        if (s.published) return s;
        require(s.checked && s.supportArranged, "请先完成核查并安排耗材支持。");
        s.published = true;
        log("总部负责人 · 王宁", "确认方案并下发湖滨店任务 · v1", "按原价 268 元精准跟进；仅使用 14:00、15:00 两个时段。耗材到位后开始，不移动已有晚间预约。");
        break;
      case "accept":
        if (s.accepted) return s;
        require(s.published, "等待总部发布任务。");
        s.accepted = true;
        log("湖滨店店长 · 李安", "接收任务，安排小林执行", "小林负责顾客跟进和服务；李安负责现场准备与进度。");
        break;
      case "receive":
        if (s.supportReceived) return s;
        require(s.accepted && s.supportArranged, "先接收任务并等待总部支持安排。");
        s.supportReceived = true;
        log("湖滨店店长 · 李安", "确认 2 份耗材已到位（模拟）", "资源前置条件已满足，现场仍需确认服务标准。");
        break;
      case "train":
        if (s.trained) return s;
        require(s.accepted, "请先接收任务。");
        s.trained = true;
        log("门店员工 · 小林", "确认服务与联系规则", "原价服务、尊重联系偏好、先确认时段，不承诺未确认的预约。");
        break;
      case "contact": {
        require(derived(s).canContact, "请先接收任务、确认耗材到位并阅读执行规则。");
        const ids = [...new Set(payload.ids || [])];
        require(ids.length > 0, "请选择顾客。");
        require(ids.every(id => customers.some(c => c.id === id && c.eligible)), "名单含已有预约或不适合联系的顾客。");
        const fresh = ids.filter(id => !s.contacted.includes(id));
        if (!fresh.length) return s;
        s.contacted.push(...fresh);
        s.contactDraft = String(payload.draft || "您好，您之前关注的护理项目有下午可选时段，方便了解一下吗？").slice(0, 800);
        log("门店员工 · 小林", `完成 ${fresh.length} 位顾客的模拟联系`, `已确认名单与草稿：「${s.contactDraft}」本地模拟，不会发送任何外部消息。`);
        break;
      }
      case "responses":
        if (s.responses) return s;
        require(["c1", "c2", "c6"].every(id => s.contacted.includes(id)), "先完成 3 位适合跟进顾客的模拟联系。");
        s.responses = true;
        log("门店 Agent", "汇总模拟回应：2 位愿意预约，1 位暂不预约", "林女士偏好 14:00，陈女士偏好 15:00；何女士本次暂不预约，停止本轮跟进。");
        break;
      case "book": {
        require(s.responses && derived(s).canContact, "请先取得顾客回应并满足现场准备条件。");
        const c = customers.find(c => c.id === payload.customerId);
        require(c && c.response === "同意预约" && s.contacted.includes(c.id), "该顾客尚未同意预约。");
        const existing = s.bookings.find(b => b.customerId === c.id);
        if (existing) {
          require(existing.slot === payload.slot, "顾客已有预约，请勿重复创建。");
          return s;
        }
        require(slots.includes(payload.slot), "请选择已核实可用的时段。");
        require(!s.bookings.some(b => b.slot === payload.slot), "该时段已被预约，请选择另一个时段。");
        s.bookings.push({ id: `SIM-${c.id}`, customerId: c.id, slot: payload.slot, staff: "小林", room: "A 护理间", date: "2026-10-21" });
        log("门店预约记录 · 模拟", `${c.name}预约确认：10月21日 ${payload.slot}`, "头皮清洁护理 · 60 分钟 · 268 元；小林 / A 护理间。未接真实预约系统。");
        break;
      }
      case "submit-execution":
        if (s.executionSubmitted) return s;
        require(derived(s).canSubmit, "请完成现场准备、顾客回应和两条预约确认。");
        s.executionSubmitted = true;
        log("湖滨店店长 · 李安", "提交执行记录，等待总部验收", "3 位已联系，2 位预约已确认，1 位暂不预约。实际到店与服务结果仍待观察。");
        break;
      case "accept-execution":
        if (s.executionAccepted) return s;
        require(s.executionSubmitted, "请等待门店提交执行记录。");
        s.executionAccepted = true;
        log("总部负责人 · 王宁", "执行验收通过，进入结果观察", "确认名单、资源、联系和预约记录齐全；不将预约数当作服务完成数。");
        break;
      case "observe":
        if (s.outcomeReady) return s;
        require(s.executionAccepted, "请先完成执行验收。");
        s.outcomeReady = true;
        log("门店 Agent · 模拟观察", "载入 10月21日模拟服务结果", "2 位均到店并完成服务；林女士另购 89 元洗护商品。没有原晚间预约转移。");
        break;
      case "review":
        if (s.reviewed) return s;
        require(s.outcomeReady, "请先载入观察结果。");
        require(["小范围继续验证", "暂停并调整"].includes(payload.decision), "请选择后续决定。");
        s.reviewed = true;
        s.decision = payload.decision;
        s.reviewNote = String(payload.note || "本轮执行链路完整；样本较小，不能认定带来因果增量。").slice(0, 600);
        log("总部负责人 · 王宁", `复盘确认：${s.decision}`, s.reviewNote);
        break;
      default: throw new Error("未知操作。");
    }
    return s;
  }
  return { VERSION, customers, slots, seed, derived, transition };
});
