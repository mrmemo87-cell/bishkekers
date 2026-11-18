// Bishkekers Telegram bot
// - customers: phone verification, points card, history, invites, partner list
// - cashiers: till (code + bill -> redeem/earn), owners: daily/monthly reports
// - admin (owner of Bishkekers): add partners, partner overview, demo reset, alerts
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://mrmemo87-cell.github.io/bishkekers/";
const BOT = "bishkekers_bot";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------- telegram helpers ----------
const token = () => Deno.env.get("BISHKEKERS_BOT_TOKEN") ?? "";
const tg = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({}));

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const som = (n: unknown) => Math.round(Number(n ?? 0)).toLocaleString("ru-RU").replace(/,/g, " ");
const pl = (n: unknown) => {
  const a = Math.abs(Math.round(Number(n ?? 0))) % 100, b = a % 10;
  return a > 10 && a < 20 ? "баллов" : b === 1 ? "балл" : b >= 2 && b <= 4 ? "балла" : "баллов";
};
const send = (chat_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
const edit = (chat_id: number, message_id: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
const rpc = async (fn: string, args: Record<string, unknown> = {}) => (await db.rpc(fn, args)).data as any;

// ---------- keyboards ----------
const K = {
  card: "💳 Моя карта", history: "📜 История", invite: "🎁 Пригласить друга", partners: "📍 Партнёры",
  till: "🧾 Новый чек", today: "📊 Сегодня", month: "📅 Месяц", cancel: "✖️ Отмена",
};
const shareKeyboard = {
  reply_markup: { keyboard: [[{ text: "📱 Подтвердить номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
};
const customerKeyboard = {
  reply_markup: { keyboard: [[{ text: K.card }, { text: K.history }], [{ text: K.invite }, { text: K.partners }]], resize_keyboard: true, is_persistent: true },
};
const staffKeyboard = {
  reply_markup: {
    keyboard: [[{ text: K.till }], [{ text: K.today }, { text: K.month }], [{ text: K.card }, { text: K.partners }]],
    resize_keyboard: true, is_persistent: true,
  },
};
const cardButtons = { reply_markup: { inline_keyboard: [[{ text: "🔄 Новый код для кассы", callback_data: "nc" }]] } };
const cancelKeyboard = { reply_markup: { keyboard: [[{ text: K.cancel }]], resize_keyboard: true } };
const joinShareKeyboard = {
  reply_markup: { keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
};
const SAFE = "🔒 Мы никогда не просим коды из SMS или Telegram, пароли или данные карты.";

// ---------- sign-up inside Telegram: step 1 (rules) -> step 2 (share number) ----------
async function joinStep1(chat: number, from: number, src: string | null, ref: string | null) {
  await rpc("bk_bot_intent", { p_tg: from, p_source: src, p_ref: ref });
  const promo = await rpc("bk_promo");
  const st = await rpc("bk_stats");
  const pts = Number(promo?.points ?? 500);
  await send(chat, [
    `👋 <b>Привет! Это Bishkekers</b> — баллы и скидки в кафе, цветочных, аптеках и маркетах Бишкека.`,
    ``,
    promo?.active ? `🔥 До 30 ноября: <b>${som(pts)} приветственных баллов</b> вместо ${som(promo.base)}.` : `🎁 <b>${som(pts)} приветственных баллов</b> за запись.`,
    `1 балл = 1 сом скидки у партнёров. Бесплатно.`,
    `<i>Приветственные баллы откроются, когда нас станет 10 000 (сейчас ${som(st?.users ?? 0)}). Баллы за покупки — сразу.</i>`,
    ``,
    `<b>Запись — 2 шага, прямо здесь:</b>`,
    `1️⃣ Согласиться с правилами`,
    `2️⃣ Поделиться номером одной кнопкой`,
    ``,
    SAFE,
  ].join("\n"), { reply_markup: { inline_keyboard: [
    [{ text: "✅ Согласен(на) с правилами — дальше", callback_data: "jy" }],
    [{ text: "📄 Правила баллов", url: `${SITE}#faq` }, { text: "🔐 Конфиденциальность", url: `${SITE}privacy.html` }],
  ] } });
}

async function joinStep2(chat: number) {
  await send(chat, [
    `<b>Шаг 2 из 2 — номер телефона</b>`,
    ``,
    `Нажми кнопку <b>«📱 Поделиться номером»</b> внизу экрана 👇`,
    `Telegram спросит, можно ли отправить твой номер Bishkekers — нажми <b>«OK»</b>.`,
    ``,
    `Мы получим только номер и имя из Telegram. Не переписку и не контакты.`,
    `Номер нужен, чтобы у каждого была только одна карта.`,
  ].join("\n"), joinShareKeyboard);
}

async function homeKeyboard(tgId: number) {
  const st = await rpc("bk_staff", { p_tg: tgId });
  return st ? staffKeyboard : customerKeyboard;
}

// ---------- secrets ----------
async function secret(): Promise<string> {
  return (await rpc("bk_webhook_secret")) ?? "";
}

// ---------- owner alerts ----------
async function alertOwner(event: string, p: Record<string, any>) {
  if (!p?.admin) return;
  const admin = Number(p.admin);
  const who = `<b>${esc(p.name)}</b> · ${esc(p.phone)}${p.district ? " · " + esc(p.district) : ""}`;
  if (event === "business_new") {
    await send(admin, `🏪 <b>New business application</b>\n\n${esc(p.business_name || "(no name)")} — ${esc(p.business_type || "")}\nContact: ${who}\n\nPhone not verified yet. Businesses so far: ${p.businesses}`);
  } else if (event === "business_verified") {
    await send(admin, `✅ <b>Business verified its number</b>\n${esc(p.business_name || "")} — ${who}`);
  } else if (event === "user_verified") {
    const n = Number(p.users);
    if (n <= 50 || n % 50 === 0) {
      await send(admin, `🙋 New verified user #${n}: ${who}${p.referred_by ? "\nInvited by code " + esc(p.referred_by) : ""}\n\nProgress: ${n} / 10 000`);
    }
  }
}

// ---------- views ----------
function bar(n: number, goal: number, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round((n / goal) * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function cardText(c: any) {
  const lines = [
    `💳 <b>Карта Bishkekers</b>`,
    ``,
    `Код для кассы:  <code>${esc(c.code)}</code>`,
    `<i>Списание баллов всегда подтверждаешь ты сам — здесь, в боте.</i>`,
    `Баланс:  <b>${som(c.available)}</b> ${pl(c.available)}  (1 балл = 1 сом)`,
  ];
  if (!c.activated && Number(c.locked) > 0) {
    lines.push(``, `🔒 <b>${som(c.locked)}</b> приветственных баллов откроются, когда нас станет 10 000`);
    lines.push(`${bar(Number(c.users), 10000)}  ${som(c.users)} / 10 000`);
  }
  lines.push(``, `Сканируй QR Bishkekers у партнёра — или назови этот код кассиру.`);
  if (Number(c.invited) > 0) lines.push(`👥 Друзей по твоей ссылке: ${c.invited}`);
  return lines.join("\n");
}

const KIND: Record<string, string> = { welcome: "🎁 Приветственные", earn: "➕ Начислено", redeem: "➖ Списано", referral: "👥 За друга", adjust: "✏️ Корректировка", expire: "⌛ Сгорели" };

function historyText(rows: any[]) {
  if (!rows?.length) return "📜 Пока нет операций. Отсканируй QR Bishkekers у партнёра, чтобы начать копить баллы.";
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Asia/Bishkek" });
  return ["📜 <b>Последние операции</b>", ""].concat(rows.map((r) => {
    const pts = Number(r.points);
    const where = r.partner ? ` · ${esc(r.partner)}${r.is_demo ? " (демо)" : ""}` : "";
    return `${fmt.format(new Date(r.created_at))}  ${KIND[r.kind] ?? r.kind}  <b>${pts > 0 ? "+" : ""}${pts}</b>${where}`;
  })).join("\n");
}

function reportText(r: any, period: string) {
  if (!r) return "Нет данных.";
  const until = new Date(r.trial_until).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" });
  const trial = new Date(r.trial_until) > new Date();
  return [
    `${period === "month" ? "📅" : "📊"} <b>${esc(r.partner)}</b> — ${period === "month" ? "этот месяц" : "сегодня"}${r.demo ? " (демо)" : ""}`,
    ``,
    `Чеков: <b>${r.bills}</b> · Клиентов: <b>${r.customers}</b>`,
    `Продажи клиентам Bishkekers: <b>${som(r.sales)} сом</b>`,
    `Скидка баллами: ${som(r.redeemed)} сом`,
    `Начислено клиентам: ${som(r.issued)} ${pl(r.issued)}`,
    ``,
    r.demo
      ? `🧪 Демо-режим: комиссия не начисляется`
      : trial
      ? `💚 Бесплатный период до ${until} — комиссия 0 сом (без него было бы ${som(r.commission_trial)} сом)`
      : `Комиссия Bishkekers: <b>${som(r.commission)} сом</b>`,
  ].join("\n");
}

const TILL_ERR: Record<string, string> = {
  not_staff: "Вы не подключены к заведению.",
  partner_inactive: "Заведение сейчас не активно в Bishkekers.",
  bad_bill: "Сумма чека должна быть от 10 до 100 000 сом.",
  no_customer: "Клиент с таким кодом не найден. Проверьте код.",
  not_verified: "Клиент ещё не подтвердил номер. Попросите его открыть @" + BOT + ".",
  self: "Нельзя проводить чек на свой собственный код.",
  duplicate: "Такой чек уже проведён только что. Если это новый чек — подождите минуту.",
  too_many: "Слишком много чеков этого клиента за сутки. Свяжитесь с Bishkekers.",
  rate: "Слишком много проверок кодов за час. Попробуйте позже.",
  nothing_to_redeem: "У клиента нет баллов для списания.",
};

// ---------- till ----------
async function tillPreview(chat: number, staffTg: number, code: string, bill: number) {
  const p = await rpc("bk_till_preview", { p_staff: staffTg, p_code: code, p_bill: bill });
  await rpc("bk_state_set", { p_tg: staffTg, p_state: null, p_data: null });
  if (!p?.ok) {
    await send(chat, `⚠️ ${TILL_ERR[p?.err] ?? "Ошибка. Попробуйте ещё раз."}`, staffKeyboard);
    return;
  }
  const c = code.toUpperCase();
  const rows: any[] = [];
  if (p.max_redeem > 0) {
    rows.push([{ text: `💳 Списать ${p.max_redeem} → к оплате ${som(bill - p.max_redeem)} сом`, callback_data: `r|${c}|${bill}|${p.max_redeem}` }]);
  }
  rows.push([{ text: `Без списания → ${som(bill)} сом`, callback_data: `e|${c}|${bill}` }]);
  rows.push([{ text: "✖️ Отмена", callback_data: "x" }]);
  await send(chat, [
    `🧾 <b>Чек ${som(bill)} сом</b>${p.demo ? "  · демо" : ""}`,
    ``,
    `👤 ${esc(p.first_name)} · баланс <b>${som(p.available)}</b> ${pl(p.available)}`,
    p.max_redeem > 0 ? `Можно списать до <b>${p.max_redeem}</b> баллов — клиент подтвердит в своём Telegram` : `Списать пока нечего — клиент получит баллы за покупку`,
  ].join("\n"), { reply_markup: { inline_keyboard: rows } });
  await send(chat, "Выберите вариант 👆", staffKeyboard);
}

async function tillEarn(chat: number, msgId: number, staffTg: number, code: string, bill: number) {
  const r = await rpc("bk_till_earn", { p_staff: staffTg, p_code: code, p_bill: bill });
  await finishBill(chat, msgId, r);
}

async function tillRedeemRequest(chat: number, msgId: number, staffTg: number, code: string, bill: number, redeem: number) {
  const q = await rpc("bk_redeem_request", { p_staff: staffTg, p_code: code, p_bill: bill, p_redeem: redeem, p_chat: chat, p_msg: msgId });
  if (!q?.ok) { await edit(chat, msgId, `⚠️ ${TILL_ERR[q?.err] ?? "Ошибка. Попробуйте ещё раз."}`); return; }
  await edit(chat, msgId, [
    `⏳ <b>Ждём подтверждения клиента</b>${q.demo ? "  · демо" : ""}`,
    ``,
    `👤 ${esc(q.first_name)} подтверждает списание <b>${q.redeem}</b> ${pl(q.redeem)} в своём Telegram.`,
    `Чек ${som(q.bill)} сом → к оплате будет ${som(Number(q.bill) - q.redeem)} сом`,
    `<i>Ждём до 3 минут.</i>`,
  ].join("\n"), { reply_markup: { inline_keyboard: [[{ text: `Провести без списания → ${som(q.bill)} сом`, callback_data: `e|${code.toUpperCase()}|${bill}` }]] } });
  await send(Number(q.customer_tg), [
    `💳 <b>${esc(q.partner)}</b>${q.demo ? " (демо)" : ""} хочет списать <b>${q.redeem}</b> ${pl(q.redeem)}`,
    `Чек ${som(q.bill)} сом → ты заплатишь ${som(Number(q.bill) - q.redeem)} сом`,
    ``,
    `Подтверди, только если ты сейчас на кассе.`,
  ].join("\n"), { reply_markup: { inline_keyboard: [[
    { text: "✅ Да, списать", callback_data: `ra|${q.id}` },
    { text: "❌ Это не я", callback_data: `rd|${q.id}` },
  ]] } });
}

async function finishBill(chat: number, msgId: number, r: any) {
  if (!r?.ok) {
    await edit(chat, msgId, `⚠️ ${TILL_ERR[r?.err] ?? "Ошибка. Чек не проведён."}`);
    return;
  }
  await edit(chat, msgId, [
    `✅ <b>Чек проведён</b>${r.demo ? "  · демо" : ""}`,
    ``,
    `💵 К оплате: <b>${som(r.cash)} сом</b>`,
    `Чек ${som(r.bill)} · списано ${r.redeem} · начислено +${r.earn}`,
    `👤 ${esc(r.first_name)} · новый баланс ${som(r.balance)}`,
  ].join("\n"));
  await sendReceipts(r);
}

async function sendReceipts(r: any) {
  if (r.customer_tg) {
    await send(Number(r.customer_tg), [
      `🧾 <b>${esc(r.partner)}</b>${r.demo ? " (демо)" : ""} · ${som(r.bill)} сом`,
      r.redeem > 0 ? `➖ ${r.redeem} ${pl(r.redeem)} списано (скидка ${r.redeem} сом)` : null,
      `➕ ${r.earn} ${pl(r.earn)} начислено`,
      r.bonus > 0 ? `👥 +${r.bonus} ${pl(r.bonus)} — бонус за приглашение!` : null,
      ``,
      `Баланс: <b>${som(r.balance)}</b> ${pl(r.balance)} 💛`,
    ].filter((x) => x !== null).join("\n"));
  }
  if (r.referrer_tg && r.ref_bonus > 0) {
    await send(Number(r.referrer_tg), `🎉 <b>+${r.ref_bonus} ${pl(r.ref_bonus)}!</b>\nТвой друг ${esc(r.first_name)} сделал первую покупку у партнёра Bishkekers. Спасибо, что зовёшь друзей!`);
  }
}

// ---------- scan-to-pay (customer scans the partner QR, staff confirms) ----------
async function createClaim(chat: number, from: number, pid: number, bill: number, redeem: number, editMsg?: number) {
  const c = await rpc("bk_claim_create", { p_tg: from, p_partner: pid, p_bill: bill, p_redeem: redeem });
  if (!c?.ok) {
    const why = c?.err === "no_staff" ? "У заведения пока нет подключённых сотрудников. Попроси провести чек по коду."
      : c?.err === "too_many_claims" ? "Слишком много запросов за час. Попробуй позже."
      : TILL_ERR[c?.err] ?? "Не получилось. Попробуй ещё раз.";
    if (editMsg) await edit(chat, editMsg, `⚠️ ${why}`); else await send(chat, `⚠️ ${why}`, await homeKeyboard(from));
    return;
  }
  const body = [
    `🧾 <b>${esc(c.partner)}</b>${c.demo ? " · демо" : ""}`,
    `Чек: ${som(c.bill)} сом`,
    c.redeem > 0 ? `💳 Баллами: −${c.redeem}` : null,
    `💵 К оплате: <b>${som(c.cash)} сом</b>`,
    `➕ Начислим: +${c.earn} ${pl(c.earn)}`,
  ].filter((x) => x !== null).join("\n");
  const custText = `⏳ <b>Ждём подтверждения официанта или кассира</b>\n\n${body}\n\n<i>Можно показать это сообщение сотруднику.</i>`;
  const cancelBtn = { reply_markup: { inline_keyboard: [[{ text: "✖️ Отменить", callback_data: `cc|${c.id}` }]] } };
  let sent: any;
  if (editMsg) { sent = await edit(chat, editMsg, custText, cancelBtn); }
  else { sent = await send(chat, custText, cancelBtn); }
  const cm = sent?.result?.message_id;
  if (cm) await rpc("bk_claim_msg", { p_claim: c.id, p_chat: chat, p_msg: cm, p_customer: true });
  if (!editMsg) await send(chat, "👆", await homeKeyboard(from));
  const staffText = [
    `🔔 <b>Bishkekers — новый чек</b>${c.demo ? " · демо" : ""}`,
    ``,
    `👤 ${esc(c.customer)}`,
    `Чек: ${som(c.bill)} сом`,
    c.redeem > 0 ? `💳 Списать баллами: ${c.redeem} (клиент уже подтвердил)` : `Без списания баллов`,
    `💵 <b>Взять с клиента: ${som(c.cash)} сом</b>`,
    ``,
    `Сверьте сумму со счётом 👇`,
  ].join("\n");
  for (const tgId of (c.staff ?? []) as number[]) {
    const m = await send(Number(tgId), staffText, { reply_markup: { inline_keyboard: [[
      { text: "✅ Подтвердить", callback_data: `ka|${c.id}` },
      { text: "❌ Сумма неверна", callback_data: `kr|${c.id}` },
    ]] } });
    if (m?.result?.message_id) await rpc("bk_claim_msg", { p_claim: c.id, p_chat: Number(tgId), p_msg: m.result.message_id });
  }
}

async function editAll(msgs: any[], text: string) {
  for (const m of msgs ?? []) await edit(Number(m.chat), Number(m.msg), text);
}

async function answerClaim(chat: number, msgId: number, from: number, id: string, confirm: boolean) {
  const a = await rpc("bk_claim_answer", { p_staff: from, p_claim: id, p_confirm: confirm });
  if (!a?.ok) {
    if (a?.err === "already") {
      const st: Record<string, string> = { confirmed: "✅ Уже подтверждено", rejected: "❌ Уже отклонено", cancelled: "✖️ Клиент отменил", expired: "⌛ Время вышло" };
      await edit(chat, msgId, st[a.status] ?? "Уже обработано.");
    } else if (a?.err === "expired") {
      await editAll(a.msgs, "⌛ Запрос устарел (больше 20 минут). Клиент может отсканировать QR снова.");
      if (a.customer_chat) await edit(Number(a.customer_chat), Number(a.customer_msg), "⌛ Сотрудник не успел подтвердить. Отсканируй QR ещё раз.");
    } else {
      await edit(chat, msgId, `⚠️ ${TILL_ERR[a?.err] ?? "Ошибка. Попробуйте ещё раз."}`);
    }
    return;
  }
  if (!a.confirmed) {
    await editAll(a.msgs, `❌ Отклонено (${esc(a.by)}): сумма не совпала со счётом.`);
    if (a.customer_chat) await edit(Number(a.customer_chat), Number(a.customer_msg), "❌ Сотрудник отметил, что сумма не совпадает со счётом.\nПроверь счёт и отсканируй QR ещё раз.");
    return;
  }
  await editAll(a.msgs, [
    `✅ <b>Чек проведён</b>${a.demo ? " · демо" : ""} · подтвердил(а) ${esc(a.by)}`,
    ``,
    `💵 Взять с клиента: <b>${som(a.cash)} сом</b>`,
    `👤 ${esc(a.first_name)} · чек ${som(a.bill)} · списано ${a.redeem} · начислено +${a.earn}`,
  ].join("\n"));
  if (a.customer_chat) await edit(Number(a.customer_chat), Number(a.customer_msg), `✅ <b>Подтверждено!</b> К оплате: ${som(a.cash)} сом`);
  await sendReceipts(a);
}

// ---------- fraud warnings ----------
const FLAG: Record<string, string> = {
  declined_redeem: "❌ Customer declined a points spend (possible stolen code)",
  code_guessing: "🔍 Many wrong customer codes (possible guessing)",
  repeat_pair: "🔁 Same cashier + customer, 3 bills in 24h",
  night_bill: "🌙 Bill late at night",
  big_bill: "💰 Very large bill",
};
const SRC: Record<string, string> = { meta: "Meta ads", instagram: "Instagram", ig: "Instagram", telegram: "Telegram", tg: "Telegram", direct: "Direct / unknown" };
const srcLines = (rows: any[]) => rows.map((x) => `• ${esc(SRC[x.source] ?? x.source)}: <b>${x.signups}</b> sign-ups, ${x.verified} confirmed`).join("\n");
const flagLine = (f: any) => `${FLAG[f.kind] ?? f.kind}${f.partner ? " · " + esc(f.partner) : ""}${f.detail ? " · " + esc(f.detail) : ""}`;

async function maybeDailyReport() {
  const r = await rpc("bk_admin_daily_report");
  if (!r?.admin) return;
  const flags = (r.flags ?? []) as any[];
  await send(Number(r.admin), [
    `☀️ <b>Bishkekers — daily report</b>`,
    ``,
    `New verified users: <b>${r.new_users}</b> (total ${som(r.total_users)} / 10 000)`,
    `New business applications: <b>${r.new_business}</b>`,
    `Bills at partners: <b>${r.bills}</b> · ${som(r.sales)} som`,
    ``,
    ((r.sources ?? []) as any[]).length ? `📣 <b>Where sign-ups came from (24h):</b>\n` + srcLines(r.sources) : `📣 No new sign-ups in 24h.`,
    ``,
    flags.length ? `🚩 <b>${flags.length} warning(s):</b>\n` + flags.slice(0, 10).map(flagLine).join("\n") : `🚩 No warnings. 👌`,
  ].join("\n"));
}

function stickerText(name: string, scan: string) {
  const link = `${SITE}sticker.html#t=${scan}&n=${encodeURIComponent(name)}`;
  return [
    `🪧 <b>QR-наклейки для «${esc(name)}»</b>`,
    ``,
    `Откройте ссылку и распечатайте: большая наклейка — на кассу, маленькие — в счёт-книжки.`,
    link,
  ].join("\n");
}

// ---------- admin ----------
async function adminCommand(chat: number, from: number, text: string) {
  if (text.startsWith("/addpartner")) {
    const m = text.replace("/addpartner", "").split("|").map((s) => s.trim());
    const name = m[0], cat = (m[1] || "").toLowerCase();
    if (!name || !["food", "retail"].includes(cat)) {
      await send(chat, "Usage: <code>/addpartner Name | food</code>\n(food = cafés, restaurants, salons, flowers · retail = pharmacies, markets)");
      return true;
    }
    const p = await rpc("bk_admin_add_partner", { p_admin: from, p_name: name, p_category: cat });
    if (!p?.ok) { await send(chat, "Not allowed."); return true; }
    const until = new Date(p.trial_until).toLocaleDateString("en-GB", { timeZone: "Asia/Bishkek" });
    await send(chat, [
      `🏪 <b>Partner added:</b> ${esc(p.name)} (${cat})`,
      `Earn ${p.earn}% · Pay with points up to ${p.redeem}% · Commission ${p.commission}% · Free until ${until}`,
      ``,
      `Send this link to the <b>owner</b> (they open it once in Telegram):`,
      `https://t.me/${BOT}?start=p_${p.join_token}`,
      ``,
      `Link for <b>cashiers</b> (owner can also get it later with /staff):`,
      `https://t.me/${BOT}?start=p_${p.staff_token}`,
      ``,
      `Printable QR stickers (counter + bill folders):`,
      `${SITE}sticker.html#t=${p.scan_token}&n=${encodeURIComponent(p.name)}`,
    ].join("\n"));
    return true;
  }
  if (text === "/partners") {
    const list = await rpc("bk_admin_partners", { p_admin: from });
    if (!list) return false;
    const lines = (list as any[]).map((p) =>
      `${p.is_demo ? "🧪" : p.active ? "🟢" : "⚪️"} <b>${esc(p.name)}</b> (${p.category}) · staff ${p.staff}\n   this month: ${p.bills} bills · ${som(p.sales)} som · commission due ${som(p.commission)}`);
    await send(chat, ["🏪 <b>Partners</b>", ""].concat(lines.length ? lines : ["No partners yet."]).join("\n"));
    return true;
  }
  if (text === "/resetdemo") {
    const n = await rpc("bk_admin_reset_demo", { p_admin: from });
    if (n === -1 || n === null) return false;
    await send(chat, `🧹 Demo cleared: ${n} demo ledger rows removed. Real data untouched.`);
    return true;
  }
  if (text === "/flags") {
    const f = await rpc("bk_admin_flags", { p_admin: from });
    if (!f) return false;
    await send(chat, ["🚩 <b>Latest warnings</b>", ""].concat((f as any[]).length ? (f as any[]).map(flagLine) : ["Nothing suspicious. 👌"]).join("\n"));
    return true;
  }
  if (text === "/sources") {
    const src = await rpc("bk_admin_sources", { p_admin: from });
    if (!src) return false;
    await send(chat, ["📣 <b>Sign-ups by source (all time)</b>", "", (src as any[]).length ? srcLines(src as any[]) : "No sign-ups yet."].join("\n"));
    return true;
  }
  if (text === "/admin") {
    const ok = await rpc("bk_admin_partners", { p_admin: from });
    if (!ok) return false;
    await send(chat, [
      "🛠 <b>Admin commands</b>",
      "/stats — verified users and businesses",
      "/partners — partners and this month's numbers",
      "/addpartner Name | food — add a partner, get owner + cashier links",
      "/flags — latest fraud warnings",
      "/sources — where sign-ups came from (Meta ads, Instagram…)",
      "/resetdemo — clear demo till transactions",
    ].join("\n"));
    return true;
  }
  return false;
}

// ---------- main ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const sec = await secret();

  // one-time setup: ?setup=<secret>
  if (url.searchParams.has("setup")) {
    if (!sec || url.searchParams.get("setup") !== sec) return new Response("forbidden", { status: 403 });
    if (!token()) return new Response("BISHKEKERS_BOT_TOKEN is not set", { status: 500 });
    const hook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bishkekers-bot`;
    const a = await tg("setWebhook", { url: hook, secret_token: sec, allowed_updates: ["message", "callback_query"] });
    const b = await tg("setMyCommands", {
      commands: [
        { command: "card", description: "Моя карта и баланс" },
        { command: "history", description: "История баллов" },
        { command: "invite", description: "Пригласить друга" },
        { command: "partners", description: "Где тратить баллы" },
      ],
    });
    const c = await tg("setMyDescription", {
      description: "Bishkekers — баллы и акции 1+1 в Бишкеке. Подтверди номер, получи карту и копи баллы у партнёров.",
    });
    const d = await tg("setMyShortDescription", { short_description: "Баллы и акции 1+1 в Бишкеке" });
    return Response.json({ webhook: a?.ok, commands: b?.ok, description: c?.ok, short: d?.ok });
  }

  // new business application ping from the page
  if (url.searchParams.has("biz")) {
    const tok = url.searchParams.get("biz") ?? "";
    if (/^[0-9a-f]{24}$/.test(tok)) {
      const data = await rpc("bk_claim_business_alert", { p_token: tok });
      if (data) await alertOwner("business_new", data);
    }
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // telegram webhook
  if (req.method !== "POST" || !sec || req.headers.get("x-telegram-bot-api-secret-token") !== sec) {
    return new Response("ok");
  }
  const update = await req.json().catch(() => ({}));
  try { await maybeDailyReport(); } catch (_e) { /* ignore */ }

  try {
    // ---- inline buttons (till confirm) ----
    const cq = update.callback_query;
    if (cq) {
      const chat = cq.message?.chat?.id as number, msgId = cq.message?.message_id as number, from = cq.from?.id as number;
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      const d = String(cq.data ?? "");
      if (d === "x") { await edit(chat, msgId, "✖️ Чек отменён."); return new Response("ok"); }
      if (d === "jy") {
        if (await rpc("bk_card", { p_tg: from })) { await edit(chat, msgId, "Ты уже в Bishkekers ✅"); await send(chat, "Твоя карта — в меню 👇", await homeKeyboard(from)); return new Response("ok"); }
        await rpc("bk_bot_consent", { p_tg: from });
        await edit(chat, msgId, "✅ <b>Шаг 1 из 2 — готово.</b> Ты согласился(лась) с правилами.");
        await joinStep2(chat);
        return new Response("ok");
      }
      let m = d.match(/^e\|([A-Z0-9]{6})\|(\d+(?:\.\d+)?)$/);
      if (m) { await edit(chat, msgId, "⏳ Проводим чек…"); await tillEarn(chat, msgId, from, m[1], Number(m[2])); return new Response("ok"); }
      m = d.match(/^r\|([A-Z0-9]{6})\|(\d+(?:\.\d+)?)\|(\d+)$/);
      if (m) { await tillRedeemRequest(chat, msgId, from, m[1], Number(m[2]), Number(m[3])); return new Response("ok"); }
      m = d.match(/^r([ad])\|([0-9a-f-]{36})$/);
      if (m) {
        const approve = m[1] === "a";
        const a = await rpc("bk_redeem_answer", { p_customer_tg: from, p_id: m[2], p_approve: approve });
        if (!a?.ok) {
          const why = a?.err === "expired" ? "⌛ Время подтверждения истекло. Попроси кассира провести чек ещё раз."
            : a?.err === "already" ? "Этот запрос уже обработан." : "Запрос не найден.";
          await edit(chat, msgId, why);
          if (a?.err === "expired" && a.cashier_chat) await edit(Number(a.cashier_chat), Number(a.cashier_msg), "⌛ Клиент не подтвердил списание за 3 минуты. Проведите чек заново.");
          return new Response("ok");
        }
        if (!approve) {
          await edit(chat, msgId, "❌ Списание отклонено. Баллы на месте.\n\nЕсли ты не был на кассе — смени код: 💳 Моя карта → 🔄 Новый код.");
          if (a.cashier_chat) await edit(Number(a.cashier_chat), Number(a.cashier_msg), "❌ <b>Клиент отклонил списание.</b>", { reply_markup: { inline_keyboard: [[{ text: `Провести без списания → ${som(a.bill)} сом`, callback_data: `e|${a.code}|${Number(a.bill)}` }]] } });
          return new Response("ok");
        }
        await edit(chat, msgId, "✅ Списание подтверждено.");
        await finishBill(Number(a.cashier_chat), Number(a.cashier_msg), a);
        return new Response("ok");
      }
      m = d.match(/^k([ar])\|([0-9a-f-]{36})$/);
      if (m) { await answerClaim(chat, msgId, from, m[2], m[1] === "a"); return new Response("ok"); }
      m = d.match(/^cs\|(\d+)\|(\d+(?:\.\d+)?)\|(\d+)$/);
      if (m) { await createClaim(chat, from, Number(m[1]), Number(m[2]), Number(m[3]), msgId); return new Response("ok"); }
      m = d.match(/^cc\|([0-9a-f-]{36})$/);
      if (m) {
        const r = await rpc("bk_claim_cancel", { p_tg: from, p_claim: m[1] });
        if (r?.ok) { await edit(chat, msgId, "✖️ Отменено."); await editAll(r.msgs, "✖️ Клиент отменил запрос."); }
        else await edit(chat, msgId, "Запрос уже обработан.");
        return new Response("ok");
      }
      if (d === "nc") {
        const code = await rpc("bk_new_card_code", { p_tg: from });
        await edit(chat, msgId, code ? `🔄 Готово! Новый код для кассы: <code>${code}</code>\nСтарый код больше не работает.` : "Не удалось сменить код.");
        return new Response("ok");
      }
      m = d.match(/^sr\|(\d+)$/);
      if (m) {
        const ok = await rpc("bk_staff_remove", { p_owner: from, p_tg: Number(m[1]) });
        await edit(chat, msgId, ok ? "🗑 Кассир удалён. Он больше не может проводить чеки." : "Не удалось удалить.");
        return new Response("ok");
      }
      if (d === "sn") {
        const t = await rpc("bk_owner_staff_token", { p_tg: from, p_rotate: true });
        await edit(chat, msgId, t ? `🔄 Новая ссылка для кассиров (старая больше не работает):\nhttps://t.me/${BOT}?start=p_${t}` : "Не удалось.");
        return new Response("ok");
      }
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg?.chat?.id || msg.chat.type !== "private") return new Response("ok");
    const chat = msg.chat.id as number;
    const from = msg.from?.id as number;

    // ---- phone verification ----
    if (msg.contact) {
      if (msg.contact.user_id !== from) {
        await send(chat, "Пожалуйста, отправь <b>свой</b> номер — нажми кнопку ниже 👇", shareKeyboard);
        return new Response("ok");
      }
      let r = await rpc("bk_tg_contact", { p_tg: from, p_phone: msg.contact.phone_number });
      if (r?.reason === "no_signup") {
        if (await rpc("bk_card", { p_tg: from })) {
          await send(chat, `Ты уже в Bishkekers ✅`, await homeKeyboard(from));
          return new Response("ok");
        }
        const nm = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
        r = await rpc("bk_bot_join", { p_tg: from, p_name: nm, p_phone: msg.contact.phone_number });
        if (r?.reason === "no_consent") {
          await send(chat, "Сначала шаг 1 — согласие с правилами 👇", { reply_markup: { remove_keyboard: true } });
          await joinStep1(chat, from, null, null);
          return new Response("ok");
        }
        if (r?.reason === "busy") {
          await send(chat, "Сейчас много записей одновременно. Нажми кнопку ещё раз через минуту 🙏", joinShareKeyboard);
          return new Response("ok");
        }
      }
      if (r?.ok) {
        const link = `https://t.me/${BOT}?start=j-ref-${r.code}`;
        if (r.already) {
          await send(chat, `Твой номер уже подтверждён ✅`, await homeKeyboard(from));
        } else if (r.kind === "business") {
          await send(chat, `Готово, номер подтверждён ✅\n\nСпасибо за заявку! Мы свяжемся с вами в ближайшее время.`, await homeKeyboard(from));
        } else {
          await send(chat, `🎉 <b>Готово, ${esc(r.name)}! Ты в Bishkekers.</b>\nНомер подтверждён ✅ Ниже — твоя карта.`, await homeKeyboard(from));
          const c = await rpc("bk_card", { p_tg: from });
          if (c) await send(chat, cardText(c));
          await send(chat, `Зови друзей — бонус получите оба:\n${link}`);
        }
        if (!r.already && r.id) {
          const p = await rpc("bk_notify_payload", { p_id: r.id });
          await alertOwner(r.kind === "business" ? "business_verified" : "user_verified", p);
        }
      } else if (r?.reason === "not_kg") {
        await send(chat, "Сейчас мы принимаем только номера Кыргызстана (+996).", { reply_markup: { remove_keyboard: true } });
      } else if (r?.reason === "phone_taken") {
        await send(chat, "Этот номер уже записан в Bishkekers. Если это ошибка — напиши нам в Instagram @bishkekers.");
      } else {
        await send(chat, "Что-то пошло не так. Давай начнём заново 👇", { reply_markup: { remove_keyboard: true } });
        await joinStep1(chat, from, null, null);
      }
      return new Response("ok");
    }

    const text: string = (msg.text ?? "").trim();

    // ---- deep links ----
    if (text.startsWith("/start")) {
      const payload = text.split(" ")[1]?.trim() ?? "";
      if (payload.startsWith("s_")) {
        const o = await rpc("bk_scan_open", { p_tg: from, p_token: payload.slice(2) });
        if (o?.ok) {
          await rpc("bk_state_set", { p_tg: from, p_state: "scan", p_data: { partner_id: o.partner_id, avail: o.available, pct: o.max_redeem_pct } });
          await send(chat, [
            `📍 <b>${esc(o.partner)}</b>${o.demo ? " · демо" : ""}`,
            ``,
            `Введи <b>сумму из счёта</b> в сомах, например <code>1200</code>`,
            `Твой баланс: ${som(o.available)} ${pl(o.available)} · начислим ${Number(o.earn_pct)}% от оплаты`,
          ].join("\n"), cancelKeyboard);
        } else if (o?.err === "not_customer") {
          await send(chat, `👋 Это QR-код Bishkekers в заведении <b>${esc(o.partner)}</b>.\nЧтобы копить здесь баллы, запишись — это 2 шага прямо тут 👇`);
          await joinStep1(chat, from, "qr", null);
        } else {
          await send(chat, "Этот QR-код больше не действует.");
        }
        return new Response("ok");
      }
      if (payload.startsWith("p_")) {
        const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
        const j = await rpc("bk_join_partner", { p_tg: from, p_token: payload.slice(2), p_name: name });
        if (j?.ok) {
          await send(chat, [
            `🏪 <b>Добро пожаловать в Bishkekers!</b>`,
            `Вы подключены к заведению <b>${esc(j.partner)}</b> как ${j.role === "owner" ? "владелец" : "кассир"}.`,
            ``,
            `<b>Как провести чек:</b>`,
            `1. Нажмите «${K.till}»`,
            `2. Введите код клиента и сумму — можно одной строкой: <code>A3F9K2 1500</code>`,
            `3. «Без списания» — сразу готово. «Списать» — клиент подтвердит в своём Telegram за пару секунд.`,
            ``,
            `<b>Ещё проще:</b> клиент сам сканирует QR Bishkekers на кассе или в счёт-книжке и вводит сумму — вам придёт сообщение, нажмите ✅.`,
            j.role === "owner" ? `\nОтчёты: «${K.today}» и «${K.month}». Сотрудники: /staff · QR-наклейки: /sticker` : ``,
          ].join("\n"), staffKeyboard);
        } else {
          await send(chat, "Ссылка недействительна. Свяжитесь с Bishkekers.");
        }
        return new Response("ok");
      }
      if (payload === "j" || payload.startsWith("j-")) {
        const c0 = await rpc("bk_card", { p_tg: from });
        if (c0) { await send(chat, `С возвращением, ${esc(c0.name)}! 👋`, await homeKeyboard(from)); await send(chat, cardText(c0), cardButtons); return new Response("ok"); }
        const parts = payload.split("-");
        await joinStep1(chat, from, parts[1] || null, parts[2] || null);
        return new Response("ok");
      }
      if (/^[0-9a-f]{24}$/.test(payload)) {
        const r = await rpc("bk_tg_start", { p_tg: from, p_token: payload });
        if (r?.found && r.verified) {
          await send(chat, `Твой номер уже подтверждён ✅`, await homeKeyboard(from));
          const c = await rpc("bk_card", { p_tg: from });
          if (c) await send(chat, cardText(c));
        } else if (r?.found) {
          await send(chat, `Привет, ${esc(r.name)}! 👋\n\nОсталось одно действие: нажми кнопку ниже, чтобы подтвердить номер. Так мы знаем, что ты настоящий человек, и засчитаем тебя в счётчик.`, shareKeyboard);
        } else {
          await send(chat, `Не нашли твою запись. Запишись на сайте:\n${SITE}`);
        }
        return new Response("ok");
      }
      const c = await rpc("bk_card", { p_tg: from });
      if (c) {
        await send(chat, `С возвращением, ${esc(c.name)}! 👋`, await homeKeyboard(from));
        await send(chat, cardText(c));
      } else {
        const st = await rpc("bk_staff", { p_tg: from });
        if (st) await send(chat, `Заведение: <b>${esc(st.partner)}</b>. Нажмите «${K.till}», чтобы провести чек.`, staffKeyboard);
        else await joinStep1(chat, from, payload || null, null);
      }
      return new Response("ok");
    }

    // ---- admin ----
    if (text.startsWith("/") && (await adminCommand(chat, from, text))) return new Response("ok");
    if (text === "/stats") {
      const st = await rpc("bk_stats");
      await send(chat, `📊 Verified users: <b>${st?.users ?? 0}</b> / 10 000\nVerified businesses: <b>${st?.businesses ?? 0}</b>`);
      return new Response("ok");
    }

    // ---- cancel ----
    if (text === K.cancel || text === "/cancel") {
      await rpc("bk_state_set", { p_tg: from, p_state: null, p_data: null });
      await send(chat, "Отменено.", await homeKeyboard(from));
      return new Response("ok");
    }

    // ---- staff: till & reports ----
    const staff = await rpc("bk_staff", { p_tg: from });
    if (staff) {
      // one-line shortcut: CODE AMOUNT
      const quick = text.match(/^([A-Za-z0-9]{6})\s+(\d{2,6})$/);
      if (quick) { await tillPreview(chat, from, quick[1], Number(quick[2])); return new Response("ok"); }

      if (text === K.till || text === "/till") {
        await rpc("bk_state_set", { p_tg: from, p_state: "code", p_data: {} });
        await send(chat, "🧾 Введите <b>код клиента</b> (6 символов).\nМожно сразу код и сумму: <code>A3F9K2 1500</code>", cancelKeyboard);
        return new Response("ok");
      }
      if (text === K.today || text === K.month || text === "/today" || text === "/month") {
        const period = text === K.month || text === "/month" ? "month" : "today";
        const r = await rpc("bk_partner_report", { p_staff: from, p_period: period });
        await send(chat, reportText(r, period), staffKeyboard);
        return new Response("ok");
      }
      if (text === "/staff" && staff.role === "owner") {
        const list = ((await rpc("bk_staff_list", { p_owner: from })) ?? []) as any[];
        const t = await rpc("bk_owner_staff_token", { p_tg: from, p_rotate: false });
        const rows = list.filter((x) => x.role === "cashier").map((x) => [{ text: `🗑 Удалить: ${x.name || x.tg}`, callback_data: `sr|${x.tg}` }]);
        rows.push([{ text: "🔄 Новая ссылка для кассиров", callback_data: "sn" }]);
        await send(chat, [
          `👥 <b>Сотрудники</b>`,
          ``,
          ...list.map((x) => `${x.role === "owner" ? "👑" : "🧾"} ${esc(x.name || x.tg)} — чеков за 30 дней: ${x.bills30}`),
          ``,
          `Ссылка для новых кассиров:`,
          `https://t.me/${BOT}?start=p_${t}`,
          `<i>Если ссылка попала не в те руки — создайте новую.</i>`,
        ].join("\n"), { reply_markup: { inline_keyboard: rows } });
        return new Response("ok");
      }
      if (text === "/sticker" && staff.role === "owner") {
        const o = await rpc("bk_owner_scan", { p_tg: from });
        if (o) await send(chat, stickerText(o.name, o.scan_token), staffKeyboard);
        return new Response("ok");
      }
      const state = await rpc("bk_state_get", { p_tg: from });
      if (state?.state === "code") {
        const code = text.replace(/\s/g, "").toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) { await send(chat, "Код — это 6 символов, например <code>A3F9K2</code>. Попробуйте ещё раз.", cancelKeyboard); return new Response("ok"); }
        await rpc("bk_state_set", { p_tg: from, p_state: "bill", p_data: { code } });
        await send(chat, `Код <code>${code}</code> ✔️\nТеперь введите <b>сумму чека</b> в сомах:`, cancelKeyboard);
        return new Response("ok");
      }
      if (state?.state === "bill") {
        const bill = Number(text.replace(/[^\d]/g, ""));
        if (!bill) { await send(chat, "Введите сумму числом, например <code>1500</code>.", cancelKeyboard); return new Response("ok"); }
        await tillPreview(chat, from, state.data.code, bill);
        return new Response("ok");
      }
    }

    // ---- customer: amount after scanning a partner QR ----
    const cst = await rpc("bk_state_get", { p_tg: from });
    if (cst?.state === "scan") {
      const bill = Number(text.replace(/[^\d]/g, ""));
      if (!bill || bill < 10 || bill > 100000) { await send(chat, "Введи сумму числом, например <code>1200</code>.", cancelKeyboard); return new Response("ok"); }
      const pid = Number(cst.data.partner_id);
      const max = Math.max(0, Math.min(Math.floor(Number(cst.data.avail)), Math.floor(bill * Number(cst.data.pct) / 100)));
      if (max > 0) {
        await rpc("bk_state_set", { p_tg: from, p_state: null, p_data: null });
        await send(chat, `🧾 Чек <b>${som(bill)} сом</b>\nОплатить часть баллами?`, { reply_markup: { inline_keyboard: [
          [{ text: `💳 Да, списать ${max} → заплачу ${som(bill - max)} сом`, callback_data: `cs|${pid}|${bill}|${max}` }],
          [{ text: `Нет, копить → ${som(bill)} сом`, callback_data: `cs|${pid}|${bill}|0` }],
        ] } });
        await send(chat, "Выбери 👆", await homeKeyboard(from));
      } else {
        await createClaim(chat, from, pid, bill, 0);
      }
      return new Response("ok");
    }

    // ---- customer ----
    if (text === K.card || text === "/card") {
      const c = await rpc("bk_card", { p_tg: from });
      if (c) await send(chat, cardText(c), cardButtons);
      else await joinStep1(chat, from, null, null);
      return new Response("ok");
    }
    if (text === K.history || text === "/history") {
      await send(chat, historyText(await rpc("bk_history", { p_tg: from })), await homeKeyboard(from));
      return new Response("ok");
    }
    if (text === K.invite || text === "/invite") {
      const c = await rpc("bk_card", { p_tg: from });
      if (!c) { await joinStep1(chat, from, null, null); return new Response("ok"); }
      const link = `https://t.me/${BOT}?start=j-ref-${c.ref}`;
      await send(chat, `🎁 <b>Пригласи друга — получите по 100 баллов оба</b>\nБонус начисляется после первой покупки друга у партнёра.\n\n${Number(c.invited) > 0 ? `👥 По твоей ссылке уже с нами: <b>${c.invited}</b>` : `Отправь тем, кто живёт рядом: семье, соседям, коллегам.`}\n\nТвоя ссылка:\n${link}`, {
        reply_markup: { inline_keyboard: [[{ text: "📨 Отправить семье и друзьям", url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Я коплю баллы в Bishkekers — в кафе и магазинах рядом с домом. Записывайся по моей ссылке: по 100 баллов получим оба.")}` }]] },
      });
      return new Response("ok");
    }
    if (text === K.partners || text === "/partners") {
      const list = (await rpc("bk_partner_list")) as any[];
      if (!list?.length) {
        await send(chat, "📍 Первые партнёры в Джале появятся совсем скоро. Мы сообщим тебе здесь! 🔔", await homeKeyboard(from));
      } else {
        const icon = (c: string) => (c === "food" ? "☕" : "🛒");
        await send(chat, ["📍 <b>Партнёры Bishkekers</b>", ""].concat(list.map((p) =>
          `${icon(p.category)} <b>${esc(p.name)}</b> — копишь ${Number(p.earn)}%, тратишь до ${Number(p.redeem)}% чека`)).join("\n"), await homeKeyboard(from));
      }
      return new Response("ok");
    }

    // fallback
    const c = await rpc("bk_card", { p_tg: from });
    if (c) await send(chat, "Выбери действие в меню 👇", await homeKeyboard(from));
    else await joinStep1(chat, from, null, null);
  } catch (_e) {
    // never make Telegram retry forever
  }
  return new Response("ok");
});
