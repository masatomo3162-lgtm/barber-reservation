// ===== 定数 =====
const WEEKDAYS = ['日','月','火','水','木','金','土'];
const START_HOUR = 8;
const END_HOUR   = 19;
const PX_PER_MIN = 3;
const INTERVAL   = 5;
const MAX_CONCURRENT_RESERVATIONS = 2; // 同じ時間帯に受けられる予約数（本人＋手伝い1名）

const MENUS = [
  { key:'cut',      label:'カット',      time:25  },
  { key:'shaving',  label:'シェービング', time:15  },
  { key:'shampoo',  label:'シャンプー',   time:15  },
  { key:'color',    label:'カラーリング', time:60  },
  { key:'perm',     label:'パーマ',       time:90  },
  { key:'ear',      label:'耳掃除',       time:10  },
  { key:'grey',     label:'白髪ぼかし',   time:20  },
  { key:'w_cut',    label:'女性カット',   time:25  },
  { key:'w_shave',  label:'女性顔そり',   time:30  },
  { key:'straight', label:'縮毛矯正',     time:180 },
];

const BLOCK_COLORS = [
  '#d35400','#1a6fa8','#27ae60','#8e44ad','#c0392b',
  '#16a085','#546e7a','#e67e22','#2980b9','#884ea0',
];

// 営業時間（START_HOUR基準の分）: 8:00=0 〜 19:00=660
const BUSINESS_START_MIN = 0;
const BUSINESS_END_MIN   = (END_HOUR - START_HOUR) * 60;

// ===== iPad/Safari互換ヘルパー =====
// 古いiPad Safariでアプリ全体が止まる原因になりやすい新しめの記法を避ける
// + 初期化エラーを画面に出して原因を追いやすくする
function valueOrDefault(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}
function pad2(value) {
  value = String(value);
  return value.length >= 2 ? value : '0' + value;
}
function showAppError(error) {
  console.error(error);
  const main = document.querySelector('main');
  if (!main) return;
  const msg = error && error.message ? error.message : String(error);
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff3f3;border:2px solid #c0392b;color:#7b1d14;border-radius:10px;padding:14px;margin:12px 0;font-size:13px;line-height:1.7;';
  box.innerHTML = '<strong>アプリの読み込み中にエラーが発生しました。</strong><br>' +
    escapeHTML(msg) + '<br><span style="color:#888;">ページを再読み込みしてください。iPadの場合はSafariのキャッシュ削除、またはホーム画面アイコンの作り直しも試してください。</span>';
  main.insertBefore(box, main.firstChild);
}

// ===== 状態 =====
let calendar;
let selectedDate      = todayStr();
let dragOffsetMin     = 0;
let touchDragState    = null; // iPad等のタッチ操作で予約を移動するための状態
let currentDetailId   = null;   // 予約詳細モーダル用
let currentDetailCustomerId = null;
let menuList          = [];     // 施術メニュー（IndexedDBから読み込む実データ）
let custSuggestActive = -1;     // 顧客検索候補のキーボード選択位置
let reopenReservationAfterCustomer = false; // 予約入力中に顧客登録した場合の復帰フラグ

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
  await initDB();
  await loadMenus();
  initCalendar();
  buildMenuGrid();
  renderMenuEditList();
  renderCustomers();
  renderTodayPanel();
  renderFreeSlots();
  renderWeekView();
  document.getElementById('customer-search')
    .addEventListener('input', e => renderCustomers(e.target.value));
  // 予約モーダルの顧客検索候補を、外側クリックで閉じる
  document.addEventListener('click', e => {
    const wrap = document.querySelector('.cust-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('res-cust-suggest').classList.remove('open');
    }
  });
  } catch (error) {
    showAppError(error);
  }
});

// ===== 施術メニュー（DB読み込み・初期投入）=====
async function loadMenus() {
  let stored = await getAllMenus();
  if (!stored || stored.length === 0) {
    // 初回のみ、既定メニューをDBに投入
    for (let i = 0; i < MENUS.length; i++) {
      const m = MENUS[i];
      await addMenu({ label: m.label, time: m.time, price: 0, order: i });
    }
    stored = await getAllMenus();
  }
  menuList = stored.sort((a, b) => valueOrDefault(a.order, 0) - valueOrDefault(b.order, 0));
}

// ===== ユーティリティ =====
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}
function dateToStr(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}
function minToPx(min) { return min * PX_PER_MIN; }
function pxToMin(px)  { return Math.round(px / PX_PER_MIN); }
function timeToMin(t) {
  const [h,m] = t.split(':').map(Number);
  return (h - START_HOUR)*60 + m;
}
function minToTime(min) {
  const tot = START_HOUR*60 + min;
  return `${pad2(Math.floor(tot/60))}:${pad2(tot%60)}`;
}
function calcEndISO(date, start, durMin) {
  const [h,m] = start.split(':').map(Number);
  const d = new Date(date+'T00:00:00');
  d.setHours(h, m+durMin);
  // ローカル時刻でISO文字列を生成（UTCズレを防ぐ）
  const yy = d.getFullYear();
  const mo = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `${yy}-${mo}-${dd}T${hh}:${mm}:00`;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}
function dateLabel(dateStr) {
  const d = new Date(dateStr+'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

function escapeHTML(value) {
  return String(valueOrDefault(value, ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : BLOCK_COLORS[0];
}

function reservationStartDate(r) {
  const time = /^\d{2}:\d{2}$/.test(r.startTime || '') ? r.startTime : '00:00';
  return new Date(`${r.date}T${time}:00`);
}

function getReservationInterval(r) {
  if (!r || !/^\d{2}:\d{2}$/.test(r.startTime || '')) return null;
  const s = timeToMin(r.startTime);
  const duration = Number(r.duration) || 0;
  if (!Number.isFinite(s) || duration <= 0) return null;
  return { id: r.id, reservation: r, s, e: s + duration + INTERVAL };
}

function intervalsOverlap(a, b) {
  return a.s < b.e && a.e > b.s;
}

function mergeSegments(segments) {
  const sorted = segments
    .filter(seg => Number.isFinite(seg.s) && Number.isFinite(seg.e) && seg.e > seg.s)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const merged = [];
  for (const seg of sorted) {
    const last = merged[merged.length - 1];
    if (last && seg.s <= last.e) {
      last.e = Math.max(last.e, seg.e);
    } else {
      merged.push({ s: seg.s, e: seg.e });
    }
  }
  return merged;
}

// ===== 空き枠計算（v1.1.0で役割を分離）=====
// ・computeFullyFreeSlots … 画面に表示する「予約が1件も入っていない連続時間」を計算する（表示専用）
// ・getReservationCapacityStatus … 同じ時間帯に最大2件まで予約できるかを判定する（登録・移動の可否専用）
// 表示用の空き枠では、予約終了時刻 = 開始時刻 + duration とし、5分インターバルは加えない。
// インターバル（INTERVAL）は従来どおり同時予約の可否判定側でのみ使用する。

// 表示用：予約が占有する時間帯（インターバルを含めない）
function getReservationBusySegment(r) {
  if (!r || !/^\d{2}:\d{2}$/.test(r.startTime || '')) return null;
  const s = timeToMin(r.startTime);
  const duration = Number(r.duration) || 0;
  if (!Number.isFinite(s) || duration <= 0) return null;
  return { s, e: s + duration };
}

// 表示用：営業時間のうち「予約が1件も入っていない」連続した空き時間を返す
function computeFullyFreeSlots(dayReservations, openStart, openEnd) {
  if (!Number.isFinite(openStart) || !Number.isFinite(openEnd) || openEnd <= openStart) return [];

  // 予約の占有時間（1件でも入っていれば「空きではない」）をまとめる
  const busy = mergeSegments(
    (dayReservations || [])
      .map(getReservationBusySegment)
      .filter(Boolean)
      .map(seg => ({ s: Math.max(openStart, seg.s), e: Math.min(openEnd, seg.e) }))
      .filter(seg => seg.e > seg.s)
  );

  if (!busy.length) return [{ s: openStart, e: openEnd }];

  // 営業時間から占有時間を引き算して空き枠を作る
  const free = [];
  let cursor = openStart;
  for (const seg of busy) {
    if (seg.s > cursor) free.push({ s: cursor, e: seg.s });
    cursor = Math.max(cursor, seg.e);
  }
  if (cursor < openEnd) free.push({ s: cursor, e: openEnd });

  // 0分・マイナスの枠は返さない
  return free.filter(f => f.e - f.s > 0);
}

function getReservationDisplayLayout(dayReservations) {
  const intervals = dayReservations
    .map(getReservationInterval)
    .filter(Boolean)
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const layout = {};
  intervals.forEach(it => { layout[it.id] = { lane: 0, parallel: false }; });

  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervals[j].s >= intervals[i].e) break;
      if (intervalsOverlap(intervals[i], intervals[j])) {
        layout[intervals[i].id].parallel = true;
        layout[intervals[j].id].parallel = true;
      }
    }
  }

  const laneEnds = Array(MAX_CONCURRENT_RESERVATIONS).fill(-Infinity);
  intervals.forEach(it => {
    let lane = laneEnds.findIndex(end => it.s >= end);
    if (lane === -1) {
      lane = laneEnds.indexOf(Math.min(...laneEnds));
    }
    layout[it.id].lane = lane;
    laneEnds[lane] = Math.max(laneEnds[lane], it.e);
  });
  return layout;
}

async function getReservationCapacityStatus(date, startTime, duration, ignoreId = null) {
  const start = timeToMin(startTime);
  const end = start + duration + INTERVAL;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
    return { allowed: true, maxOverlap: 0, conflicts: [], conflictAt: null };
  }

  const reservations = await getAllReservations();
  const candidate = { s: start, e: end };
  const overlaps = reservations
    .filter(r => r.date === date && r.id !== ignoreId)
    .map(getReservationInterval)
    .filter(Boolean)
    .filter(it => intervalsOverlap(candidate, it));

  if (!overlaps.length) {
    return { allowed: true, maxOverlap: 0, conflicts: [], conflictAt: null };
  }

  const points = [start, end];
  overlaps.forEach(it => {
    points.push(Math.max(start, it.s));
    points.push(Math.min(end, it.e));
  });
  const sortedPoints = Array.from(new Set(points))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);

  let maxOverlap = 0;
  let conflicts = [];
  let conflictAt = null;
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const segStart = sortedPoints[i];
    const segEnd = sortedPoints[i + 1];
    if (segEnd <= segStart) continue;
    const active = overlaps.filter(it => it.s < segEnd && it.e > segStart);
    maxOverlap = Math.max(maxOverlap, active.length);
    if (active.length >= MAX_CONCURRENT_RESERVATIONS) {
      conflicts = active;
      conflictAt = segStart;
      break;
    }
  }

  return {
    allowed: conflictAt === null,
    maxOverlap,
    conflicts: conflicts.map(it => it.reservation),
    conflictAt,
  };
}

async function findReservationConflict(date, startTime, duration, ignoreId = null) {
  const status = await getReservationCapacityStatus(date, startTime, duration, ignoreId);
  if (status.allowed) return null;
  const first = status.conflicts[0] || null;
  if (first) return first;
  return { startTime: status.conflictAt !== null ? minToTime(status.conflictAt) : startTime };
}

function refreshCalendar() {
  if (calendar) calendar.refetchEvents();
}

// ===== 本日の空き時間（ダッシュボード）=====
async function renderFreeSlots() {
  const el = document.getElementById('free-slots-list');
  if (!el) return;
  const today = todayStr();
  const OPEN_START = (9  - START_HOUR) * 60;  // 9:00
  const OPEN_END   = (19 - START_HOUR) * 60;  // 19:00

  const reservations = await getAllReservations();
  const dayRes = reservations.filter(r => r.date === today);

  // 現在時刻（今日基準・分）を5分単位に切り上げ。過去の時間帯は空きに含めない
  const now = new Date();
  let nowMin = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  nowMin = Math.ceil(nowMin / 5) * 5;
  const effectiveStart = Math.max(OPEN_START, nowMin);

  if (effectiveStart >= OPEN_END) {
    el.innerHTML = '<span class="free-empty">本日の営業時間は終了しました</span>';
    return;
  }

  // 日別タイムスケジュールと同じ計算ルール（予約が1件も入っていない時間のみ空き枠）
  const shown = computeFullyFreeSlots(dayRes, effectiveStart, OPEN_END)
    .filter(f => f.e - f.s >= 5); // 5分未満は表示しない
  if (!shown.length) {
    el.innerHTML = '<span class="free-empty">本日の完全な空き時間はありません</span>';
    return;
  }
  el.innerHTML = '<div class="free-chips">' + shown.map(f =>
    `<span class="free-chip">空き枠 ${minToTime(f.s)}〜${minToTime(f.e)}（${f.e - f.s}分）</span>`
  ).join('') + '</div>';
}

// ===== TODAY パネル =====
async function renderTodayPanel() {
  renderFreeSlots();
  const today = todayStr();
  const d = new Date(today+'T00:00:00');
  document.getElementById('today-panel-title').textContent =
    `📅 ${d.getMonth()+1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）の予約`;

  const reservations = await getAllReservations();
  const customers    = await getAllCustomers();
  const list = document.getElementById('today-list');

  const items = reservations
    .filter(r => r.date === today)
    .sort((a,b) => a.startTime.localeCompare(b.startTime));

  if (!items.length) {
    list.innerHTML = '<div class="today-empty">本日の予約はありません</div>';
    return;
  }

  list.innerHTML = '';
  items.forEach(r => {
    const cust = customers.find(c => c.id === r.customerId);
    const endMin  = timeToMin(r.startTime) + r.duration;
    const endTime = minToTime(endMin);
    const div = document.createElement('div');
    div.className = 'today-list-item';
    div.onclick = () => showResDetail(r.id);
    div.innerHTML = `
      <div class="today-color-dot" style="background:${safeColor(r.color)};"></div>
      <div style="flex:1;min-width:0;">
        <div class="today-time">${r.startTime} 〜 ${endTime}</div>
        <div class="today-name">${escapeHTML(cust ? cust.name : '顧客不明')}</div>
        <div class="today-menu">${escapeHTML((r.menus || []).join('・'))}</div>
      </div>
      <div class="today-price">${r.price ? r.price.toLocaleString()+'円' : ''}</div>
    `;
    list.appendChild(div);
  });
}

// ===== WEEK VIEW =====
async function renderWeekView() {
  const reservations = await getAllReservations();
  const customers    = await getAllCustomers();
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const today = new Date(todayStr()+'T00:00:00');

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = dateToStr(d);
    const wd = d.getDay();
    const isToday = (i === 0);
    const isSun = wd === 0;
    const isSat = wd === 6;

    const col = document.createElement('div');
    col.className = `week-col${isToday ? ' today-col' : ''}${isSun ? ' week-col-sun' : ''}${isSat ? ' week-col-sat' : ''}`;

    const dayItems = reservations
      .filter(r => r.date === dateStr)
      .sort((a,b) => a.startTime.localeCompare(b.startTime));

    let itemsHTML = '';
    dayItems.forEach(r => {
      const cust = customers.find(c => c.id === r.customerId);
      itemsHTML += `
        <div class="week-res-item" style="background:${safeColor(r.color)};"
             onclick="showResDetail(${r.id})">
          <div class="week-res-name">${escapeHTML(cust ? cust.name : '?')}</div>
          <div class="week-res-time">${r.startTime}（${r.duration}分）</div>
        </div>`;
    });

    col.innerHTML = `
      <div class="week-col-header" style="cursor:pointer;" onclick="openDayView('${dateStr}')">
        <div class="week-col-day">${WEEKDAYS[wd]}</div>
        <div class="week-col-date">${d.getDate()}</div>
      </div>
      <div class="week-col-body">
        ${itemsHTML || '<div style="font-size:11px;color:#ccc;padding:4px 2px;">—</div>'}
      </div>`;
    grid.appendChild(col);
  }
}

// ===== 予約詳細モーダル =====
async function showResDetail(id) {
  const all  = await getAllReservations();
  const custs = await getAllCustomers();
  const r = all.find(x => x.id === id);
  if (!r) return;
  currentDetailId = id;

  const cust = custs.find(c => c.id === r.customerId);
  const endMin  = timeToMin(r.startTime) + r.duration;
  const endTime = minToTime(endMin);

  document.getElementById('detail-dot').style.background = safeColor(r.color);
  document.getElementById('detail-cust-name2').textContent = cust ? cust.name : '顧客不明';
  document.getElementById('res-detail-body').innerHTML = `
    <div class="res-detail-row">
      <span class="res-detail-label">日付</span>
      <span>${dateLabel(r.date)}</span>
    </div>
    <div class="res-detail-row">
      <span class="res-detail-label">時間</span>
      <span>${r.startTime} 〜 ${endTime}（${r.duration}分）</span>
    </div>
    <div class="res-detail-row">
      <span class="res-detail-label">メニュー</span>
      <span>${escapeHTML((r.menus || []).join('・'))}</span>
    </div>
    <div class="res-detail-row">
      <span class="res-detail-label">料金</span>
      <span>${r.price ? r.price.toLocaleString()+'円' : '未設定'}</span>
    </div>
    ${cust && cust.phone ? `<div class="res-detail-row"><span class="res-detail-label">電話番号</span><span>${escapeHTML(cust.phone)}</span></div>` : ''}
    ${cust && cust.note ? `<div class="res-detail-row"><span class="res-detail-label">メモ</span><span style="font-size:12px;">${escapeHTML(cust.note).replace(/\n/g, '<br>')}</span></div>` : ''}
  `;
  document.getElementById('res-detail-modal').classList.add('open');
}

function editFromDetail() {
  closeModal('res-detail-modal');
  editReservation(currentDetailId);
}

async function deleteFromDetail() {
  if (!currentDetailId || !confirm('この予約を取り消しますか？')) return;
  await deleteReservation(currentDetailId);
  await autoBackup();
  closeModal('res-detail-modal');
  await renderTodayPanel();
  await renderWeekView();
  if (document.getElementById('day-view-section').classList.contains('active')) {
    await renderTimeline(selectedDate);
  }
  refreshCalendar();
  showToast('予約を取り消しました');
}

// ===== カレンダー =====
function initCalendar() {
  const el = document.getElementById('calendar-view');
  if (!window.FullCalendar || typeof window.FullCalendar.Calendar !== 'function') {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--red);">カレンダーを読み込めませんでした。通信を確認して再読み込みしてください。<br><span style="font-size:12px;color:var(--muted);">顧客管理・設定・CSVバックアップは利用できます。</span></div>';
    calendar = null;
    return;
  }
  calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    locale: 'ja',
    timeZone: 'local',
    headerToolbar: { left:'prev,next today', center:'title', right:'dayGridMonth' },
    height: 'auto',
    dayMaxEvents: 3,
    dateClick: info => openDayView(info.dateStr),
    eventClick: info => { openDayView(info.event.startStr.slice(0,10)); },
    events: async (fetchInfo, success) => {
      const res = await getAllReservations();
      success(res.map(r => ({
        id: String(r.id),
        title: (r.menus || [])[0] || '',
        start: `${r.date}T${r.startTime}`,
        end: calcEndISO(r.date, r.startTime, r.duration+INTERVAL),
        backgroundColor: safeColor(r.color),
        borderColor: 'transparent',
        textColor: '#fff',
      })));
    }
  });
  calendar.render();
}

function openDayView(date) {
  selectedDate = date;
  const d = new Date(date+'T00:00:00');
  document.getElementById('selected-date-display').textContent =
    `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  document.getElementById('selected-weekday-display').textContent =
    `（${WEEKDAYS[d.getDay()]}曜日）`;
  // カレンダーsectionを非表示、day-view-sectionを表示
  document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
  document.getElementById('day-view-section').classList.add('active');
  renderTimeline(date);
}

function backToCalendar() {
  document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
  document.getElementById('calendar').classList.add('active');
  // navボタンのactiveをカレンダーに戻す
  document.querySelectorAll('nav button').forEach((b,i) => b.classList.toggle('active', i===0));
  refreshCalendar();
  renderTodayPanel();
  renderWeekView();
}

// ===== タイムライン =====
async function renderTimeline(date) {
  const labelsEl = document.getElementById('time-labels');
  const gridEl   = document.getElementById('grid-lines');
  const resArea  = document.getElementById('reservations-area');
  labelsEl.innerHTML = '';
  gridEl.innerHTML   = '';
  resArea.innerHTML  = '';

  const totalMin = (END_HOUR - START_HOUR) * 60;

  for (let min = 0; min <= totalMin; min += 10) {
    const y = minToPx(min);
    const isHour = min%60===0, isHalf = min%30===0 && !isHour;
    const line = document.createElement('div');
    line.className = `grid-line ${isHour?'hour':isHalf?'half':'ten'}`;
    line.style.top = y+'px';
    gridEl.appendChild(line);
    if (isHour) {
      const h = START_HOUR + min/60;
      const lb = document.createElement('div');
      lb.className = 'time-label';
      lb.style.top = y+'px';
      lb.textContent = `${h}:00`;
      labelsEl.appendChild(lb);
    }
  }

  const reservations = await getAllReservations();
  const customers    = await getAllCustomers();
  const dayRes = reservations
    .filter(r => r.date === date)
    .sort((a,b) => a.startTime.localeCompare(b.startTime));

  // ===== 空き時間バー（9:00〜19:00）=====
  const OPEN_START = (9  - START_HOUR) * 60;  // 9:00 → min from START_HOUR
  const OPEN_END   = (19 - START_HOUR) * 60;  // 19:00
  // 空き時間を算出（予約が1件も入っていない連続時間のみを空き枠として表示）
  // ※同時予約2枠の可否判定は getReservationCapacityStatus 側で従来どおり行う
  const freeSlots = computeFullyFreeSlots(dayRes, OPEN_START, OPEN_END);

  // 空き時間バーを描画
  freeSlots.forEach(slot => {
    const dur = slot.e - slot.s;
    if (dur <= 0) return; // 0分・マイナスの枠は描画しない
    const top    = minToPx(slot.s);
    const height = minToPx(dur);
    if (height < 1) return;
    const bar = document.createElement('div');
    bar.className = 'free-slot';
    bar.style.cssText = `top:${top}px;height:${height}px;`;
    const label = document.createElement('div');
    label.className = 'free-slot-label';
    label.textContent = `空き枠 ${minToTime(slot.s)}〜${minToTime(slot.e)}（${dur}分）`;
    bar.appendChild(label);
    resArea.appendChild(bar);
  });

  const timelineLayout = getReservationDisplayLayout(dayRes);

  dayRes
    .forEach(r => {
      const cust     = customers.find(c => c.id === r.customerId);
      const startMin = timeToMin(r.startTime);
      if (startMin < 0 || startMin > totalMin) return;
      const top    = minToPx(startMin);
      const height = Math.max(minToPx(r.duration), minToPx(10));
      const endTime = minToTime(startMin + r.duration);

      const block = document.createElement('div');
      block.className = 'res-block';
      block.dataset.id = r.id;
      const layout = timelineLayout[r.id] || { lane: 0, parallel: false };
      const laneStyle = layout.parallel
        ? (layout.lane === 0 ? 'left:4px;right:calc(50% + 2px);' : 'left:calc(50% + 2px);right:4px;')
        : 'left:4px;right:4px;';
      block.style.cssText = `top:${top}px;height:${height}px;${laneStyle}background:${safeColor(r.color)};color:#fff;border-left-color:rgba(0,0,0,0.28);`;
      block.innerHTML = `
        <div class="res-block-name">${escapeHTML(cust ? cust.name : '顧客不明')}</div>
        <div class="res-block-menu">${escapeHTML((r.menus || []).join('・'))}</div>
        <div class="res-block-time">${r.startTime} 〜 ${endTime}（${r.duration}分）</div>
      `;
      block.addEventListener('click', () => showResDetail(r.id));

      block.draggable = true;
      block.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', String(r.id));
        const blockRect = block.getBoundingClientRect();
        dragOffsetMin = pxToMin(e.clientY - blockRect.top);
        block.classList.add('dragging');
        document.getElementById('drag-indicator').style.display = 'block';
      });
      block.addEventListener('dragend', () => {
        block.classList.remove('dragging');
        document.getElementById('drag-indicator').style.display = 'none';
      });

      // iPad SafariはHTML5ドラッグが不安定なので、タッチ移動でも予約を動かせるようにする
      block.addEventListener('touchstart', e => {
        if (!e.touches || !e.touches.length) return;
        const touch = e.touches[0];
        const blockRect = block.getBoundingClientRect();
        touchDragState = {
          id: r.id,
          offsetMin: pxToMin(touch.clientY - blockRect.top),
          startY: touch.clientY,
          moved: false,
        };
      }, { passive: true });

      block.addEventListener('touchmove', e => {
        if (!touchDragState || !e.touches || !e.touches.length) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientY - touchDragState.startY) > 8) touchDragState.moved = true;
        if (!touchDragState.moved) return;
        e.preventDefault();
        const rect = resArea.getBoundingClientRect();
        const snapped = Math.round((pxToMin(touch.clientY - rect.top) - touchDragState.offsetMin) / 5) * 5;
        const clamped = Math.max(0, Math.min(snapped, totalMin - 10));
        const ind = document.getElementById('drag-indicator');
        ind.textContent = minToTime(clamped);
        ind.style.left = (touch.clientX + 14) + 'px';
        ind.style.top = (touch.clientY - 14) + 'px';
        ind.style.display = 'block';
      }, { passive: false });

      block.addEventListener('touchend', async e => {
        if (!touchDragState) return;
        const state = touchDragState;
        touchDragState = null;
        document.getElementById('drag-indicator').style.display = 'none';
        if (!state.moved || !e.changedTouches || !e.changedTouches.length) return;
        e.preventDefault();
        const touch = e.changedTouches[0];
        const rect = resArea.getBoundingClientRect();
        const snapped = Math.round((pxToMin(touch.clientY - rect.top) - state.offsetMin) / 5) * 5;
        await moveReservationToSnappedPosition(state.id, snapped, date, totalMin);
      }, { passive: false });

      resArea.appendChild(block);
    });

  async function moveReservationToSnappedPosition(id, snapped, dateForMove, totalMinForMove) {
    const all = await getAllReservations();
    const res = all.find(r => r.id === id);
    if (!res) return;
    const maxStart = Math.max(0, totalMinForMove - ((Number(res.duration) || 0) + INTERVAL));
    const clamped = Math.max(0, Math.min(snapped, maxStart));
    const newStartTime = minToTime(clamped);
    const conflict = await findReservationConflict(dateForMove, newStartTime, Number(res.duration) || 0, id);
    if (conflict) {
      alert(`その時間帯は2名分の予約が埋まっています（${conflict.startTime}開始の予約あり）。`);
      await renderTimeline(dateForMove);
      return;
    }
    res.startTime = newStartTime;
    await updateReservation(res);
    await autoBackup();
    await renderTimeline(dateForMove);
    await renderTodayPanel();
    await renderWeekView();
    refreshCalendar();
  }

  // renderTimelineを呼び直してもイベントが二重登録されないよう、on...で上書きする
  resArea.ondragover = e => {
    e.preventDefault();
    const rect = resArea.getBoundingClientRect();
    const snapped = Math.round((pxToMin(e.clientY-rect.top)-dragOffsetMin)/5)*5;
    const clamped = Math.max(0, Math.min(snapped, totalMin-10));
    const ind = document.getElementById('drag-indicator');
    ind.textContent = minToTime(clamped);
    ind.style.left = (e.clientX+14)+'px';
    ind.style.top  = (e.clientY-14)+'px';
  };

  resArea.ondrop = async e => {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData('text/plain'));
    const rect = resArea.getBoundingClientRect();
    const snapped = Math.round((pxToMin(e.clientY-rect.top)-dragOffsetMin)/5)*5;
    await moveReservationToSnappedPosition(id, snapped, date, totalMin);
    document.getElementById('drag-indicator').style.display = 'none';
  };

  document.getElementById('timeline-scroll').scrollTop = minToPx(timeToMin('09:00'))-40;
}

// ===== 予約編集モーダル =====
function buildMenuGrid() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = '';
  if (!menuList.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:var(--muted);">メニューが登録されていません。設定画面で追加してください。</div>';
    return;
  }
  menuList.forEach(m => {
    const item = document.createElement('label');
    item.className = 'menu-item';
    item.innerHTML = `
      <input type="checkbox" name="menu" value="${m.id}" data-time="${m.time}" data-label="${escapeHTML(m.label)}">
      <div><div class="menu-item-name">${escapeHTML(m.label)}</div><div class="menu-item-time">${m.time}分</div></div>
    `;
    const cb = item.querySelector('input');
    cb.addEventListener('change', () => {
      item.classList.toggle('checked', cb.checked);
      updateTotalTime();
    });
    grid.appendChild(item);
  });
}

function updateTotalTime() {
  const total = Array.from(document.querySelectorAll('#menu-grid input[name="menu"]:checked'))
    .reduce((s,cb) => s+parseInt(cb.dataset.time), 0);
  document.getElementById('res-total-time').textContent = total;
  onStartTimeChange();
}

function openReservationModal() {
  document.getElementById('reservation-modal-title').textContent = '新規予約';
  document.getElementById('res-id').value = '';
  document.getElementById('res-start-time').value = '09:00';
  document.getElementById('res-price').value = '';
  document.querySelectorAll('#menu-grid input[name="menu"]').forEach(cb => {
    cb.checked = false;
    cb.closest('.menu-item').classList.remove('checked');
  });
  updateTotalTime();
  clearSelectedCustomer();
  onStartTimeChange();
  document.getElementById('reservation-modal').classList.add('open');
}

async function editReservation(id) {
  const all = await getAllReservations();
  const res = all.find(r => r.id === id);
  if (!res) return;
  document.getElementById('reservation-modal-title').textContent = '予約を編集';
  document.getElementById('res-id').value = res.id;
  document.getElementById('res-start-time').value = res.startTime;
  document.getElementById('res-price').value = res.price || '';
  document.querySelectorAll('#menu-grid input[name="menu"]').forEach(cb => {
    cb.checked = (res.menus || []).includes(cb.dataset.label);
    cb.closest('.menu-item').classList.toggle('checked', cb.checked);
  });
  updateTotalTime();
  await setSelectedCustomer(res.customerId);
  onStartTimeChange();
  document.getElementById('reservation-modal').classList.add('open');
}

// ===== 顧客選択（検索式）=====
// 全角英数字を半角に寄せる（例：０９０ → 090）
function toHalfWidthAlnum(s) {
  return String(s || '').replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function normalizeKana(s) {
  // カタカナをひらがなに寄せて検索しやすくする（漢字の読みまではデータが無いので対象外）
  // 全角英数字も半角化して、名前に含まれる数字・英字の表記ゆれを吸収する
  return toHalfWidthAlnum(String(s || '')).toLowerCase().replace(/[\u30a1-\u30f6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 電話番号検索用：全角数字を半角化し、数字以外（ハイフン・空白・括弧など）をすべて除去する
function normalizePhone(s) {
  return toHalfWidthAlnum(String(s || '')).replace(/[^0-9]/g, '');
}

// 名前（部分一致・かな正規化）または電話番号（部分一致・数字のみ比較）で顧客を判定する
// 新規予約・予約編集の顧客検索と、顧客管理画面の検索の両方で同じ判定を使う
function customerMatchesQuery(customer, rawQuery) {
  const raw = String(rawQuery || '').trim();
  if (!raw) return true;
  const nameQuery = normalizeKana(raw);
  if (nameQuery && normalizeKana(customer.name).includes(nameQuery)) return true;
  const phoneQuery = normalizePhone(raw);
  if (phoneQuery && normalizePhone(customer.phone).includes(phoneQuery)) return true;
  return false;
}

async function setSelectedCustomer(customerId) {
  const customers = await getAllCustomers();
  const c = customers.find(x => x.id === customerId);
  if (!c) { clearSelectedCustomer(); return; }
  document.getElementById('res-customer-id').value = c.id;
  document.getElementById('res-cust-selected-name').textContent =
    c.name + (c.phone ? `（${c.phone}）` : '');
  document.getElementById('res-cust-selected').classList.add('show');
  const searchEl = document.getElementById('res-cust-search');
  searchEl.value = '';
  searchEl.style.display = 'none';
  document.getElementById('res-cust-suggest').classList.remove('open');
}

function clearSelectedCustomer() {
  document.getElementById('res-customer-id').value = '';
  const box = document.getElementById('res-cust-selected');
  const searchEl = document.getElementById('res-cust-search');
  const suggest = document.getElementById('res-cust-suggest');
  if (box) box.classList.remove('show');
  if (searchEl) { searchEl.value = ''; searchEl.style.display = ''; searchEl.focus(); }
  if (suggest) { suggest.classList.remove('open'); suggest.innerHTML = ''; }
}

async function onCustSearchInput() {
  const searchEl = document.getElementById('res-cust-search');
  const suggest = document.getElementById('res-cust-suggest');
  const raw = searchEl.value.trim();
  const customers = await getAllCustomers();

  if (!customers.length) {
    suggest.innerHTML = '<div class="cust-suggest-empty">顧客が登録されていません。「＋ 新規顧客登録」から追加してください</div>';
    suggest.classList.add('open');
    return;
  }
  const matches = !raw
    ? customers.slice(0, 30)
    : customers.filter(c => customerMatchesQuery(c, raw));

  if (!matches.length) {
    suggest.innerHTML = '<div class="cust-suggest-empty">該当する顧客がいません</div>';
    suggest.classList.add('open');
    return;
  }
  suggest.innerHTML = matches.map(c =>
    `<div class="cust-suggest-item" onclick="selectCustomerFromSuggest(${c.id})">
      ${escapeHTML(c.name)}<span class="cs-phone">${c.phone ? escapeHTML(c.phone) : '電話番号なし'}</span>
    </div>`
  ).join('');
  suggest.classList.add('open');
}

async function selectCustomerFromSuggest(id) {
  await setSelectedCustomer(id);
}

function openCustomerModalFromReservation() {
  // 予約入力中の内容（メニュー・時間・料金）はそのまま保持し、顧客モーダルを重ねて開く
  reopenReservationAfterCustomer = true;
  openCustomerModal();
}

// ===== 開始時間スピナー =====
function stepStartTime(deltaMin) {
  const el = document.getElementById('res-start-time');
  let cur = (el.value && /^\d{2}:\d{2}$/.test(el.value)) ? timeToMin(el.value) : 60;
  cur += deltaMin;
  cur = Math.max(BUSINESS_START_MIN, Math.min(cur, BUSINESS_END_MIN));
  el.value = minToTime(cur);
  onStartTimeChange();
}

async function onStartTimeChange() {
  const el = document.getElementById('res-start-time');
  const hint = document.getElementById('time-hint');
  if (!el || !hint) return;
  if (!el.value || !/^\d{2}:\d{2}$/.test(el.value)) { hint.textContent = ''; hint.className = 'time-hint'; return; }
  let min = timeToMin(el.value);
  if (min < BUSINESS_START_MIN) { min = BUSINESS_START_MIN; el.value = minToTime(min); }
  if (min > BUSINESS_END_MIN)   { min = BUSINESS_END_MIN;   el.value = minToTime(min); }

  const total = Array.from(document.querySelectorAll('#menu-grid input[name="menu"]:checked'))
    .reduce((s, cb) => s + parseInt(cb.dataset.time, 10), 0);

  const idValue = document.getElementById('res-id').value;
  const editId = idValue ? parseInt(idValue, 10) : null;
  let date = selectedDate;
  if (editId) {
    const all = await getAllReservations();
    const ex = all.find(r => r.id === editId);
    if (ex) date = ex.date;
  }

  if (total > 0 && min + total + INTERVAL > BUSINESS_END_MIN) {
    hint.textContent = `⚠ 施術終了が営業終了（${minToTime(BUSINESS_END_MIN)}）を超えます`;
    hint.className = 'time-hint warn';
    return;
  }
  if (total > 0) {
    const status = await getReservationCapacityStatus(date, el.value, total, editId);
    if (!status.allowed) {
      const conflictText = status.conflicts.length
        ? status.conflicts.map(r => r.startTime).join('・')
        : minToTime(status.conflictAt);
      hint.textContent = `⚠ その時間帯は2名分の予約が埋まっています（${conflictText} 開始の予約あり）`;
      hint.className = 'time-hint warn';
      return;
    }
    if (status.maxOverlap === 1) {
      hint.textContent = `✓ 同時予約2枠目として登録できます`;
      hint.className = 'time-hint ok';
      return;
    }
  }
  hint.textContent = `${el.value} 開始`;
  hint.className = 'time-hint';
}

async function handleReservationSubmit(e) {
  e.preventDefault();
  const idValue = document.getElementById('res-id').value;
  const id = idValue ? parseInt(idValue, 10) : null;
  const checked = document.querySelectorAll('#menu-grid input[name="menu"]:checked');
  const menus = Array.from(checked).map(cb => cb.dataset.label);
  const total = Array.from(checked).reduce((sum, cb) => sum + parseInt(cb.dataset.time, 10), 0);
  if (!menus.length) { alert('メニューを1つ以上選択してください'); return; }

  const customerId = parseInt(document.getElementById('res-customer-id').value, 10);
  const startTime = document.getElementById('res-start-time').value;
  if (!Number.isInteger(customerId) || !startTime) {
    alert('顧客と開始時間を確認してください');
    return;
  }

  let existing = null;
  if (id) {
    const all = await getAllReservations();
    existing = all.find(r => r.id === id) || null;
    if (!existing) {
      alert('編集対象の予約が見つかりません。画面を更新してください。');
      return;
    }
  }

  const date = existing ? existing.date : selectedDate;
  const conflict = await findReservationConflict(date, startTime, total, id);
  if (conflict) {
    alert(`その時間帯は2名分の予約が埋まっています（${conflict.startTime}開始の予約あり）。`);
    return;
  }

  const data = {
    customerId,
    date,
    startTime,
    duration: total,
    menus,
    price: Math.max(0, parseInt(document.getElementById('res-price').value, 10) || 0),
    color: existing ? safeColor(existing.color) : BLOCK_COLORS[Math.floor(Math.random() * BLOCK_COLORS.length)],
  };

  if (existing) {
    data.id = id;
    await updateReservation(data);
    showToast('予約を更新しました');
  } else {
    await addReservation(data);
    showToast('予約を追加しました');
  }

  await autoBackup();
  closeModal('reservation-modal');
  if (document.getElementById('day-view-section').classList.contains('active')) {
    await renderTimeline(selectedDate);
  }
  await renderTodayPanel();
  await renderWeekView();
  refreshCalendar();
}

// ===== 顧客 =====
async function renderCustomers(filter='') {
  const customers = await getAllCustomers();
  const reservations = await getAllReservations();
  const list = document.getElementById('customer-list');
  const now = new Date();
  list.innerHTML = '';

  customers
    .filter(c => customerMatchesQuery(c, filter))
    .forEach(c => {
      const hist = reservations
        .filter(r => r.customerId === c.id && reservationStartDate(r) <= now)
        .sort((a, b) => reservationStartDate(b) - reservationStartDate(a));
      const last = hist[0];
      let lastText = 'なし', daysText = '';
      if (last) {
        const lastDate = new Date(last.date + 'T00:00:00');
        const today = new Date(todayStr() + 'T00:00:00');
        const diff = Math.max(0, Math.floor((today - lastDate) / 86400000));
        lastText = escapeHTML(last.date);
        daysText = `<span class="days-ago">${diff === 0 ? '本日' : diff + '日前'}</span>`;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a href="#" style="color:var(--accent);font-weight:700;text-decoration:none;"
              onclick="showCustomerDetail(${c.id});return false;">${escapeHTML(c.name)}</a></td>
        <td>${escapeHTML(c.phone || '—')}</td>
        <td>${lastText}${daysText}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="openCustomerEdit(${c.id})">編集</button></td>
      `;
      list.appendChild(tr);
    });
}

function openCustomerModal() {
  document.getElementById('customer-modal-title').textContent = '新規顧客登録';
  ['cust-id','cust-name','cust-phone','cust-note'].forEach(id => document.getElementById(id).value='');
  document.getElementById('cust-delete-btn').style.display = 'none';
  document.getElementById('customer-modal').classList.add('open');
}

async function openCustomerEdit(id) {
  const customers = await getAllCustomers();
  const c = customers.find(x => x.id===id);
  if (!c) return;
  document.getElementById('customer-modal-title').textContent = '顧客情報を編集';
  document.getElementById('cust-id').value    = c.id;
  document.getElementById('cust-name').value  = c.name;
  document.getElementById('cust-phone').value = c.phone||'';
  document.getElementById('cust-note').value  = c.note||'';
  document.getElementById('cust-delete-btn').style.display = 'inline-block';
  document.getElementById('customer-modal').classList.add('open');
}

async function handleCustomerSubmit(e) {
  e.preventDefault();
  // 予約起点かどうかを先に確保（closeModalでフラグが消えても影響しないように）
  const fromReservation = reopenReservationAfterCustomer;
  reopenReservationAfterCustomer = false;

  const id = document.getElementById('cust-id').value;
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const note = document.getElementById('cust-note').value;
  if (!name) { alert('名前を入力してください'); reopenReservationAfterCustomer = fromReservation; return; }

  const customer = { name, phone, note, updatedAt: new Date().toISOString() };
  let savedId;

  if (id) {
    const customerId = parseInt(id, 10);
    const existingCustomers = await getAllCustomers();
    const existing = existingCustomers.find(c => c.id === customerId);
    customer.id = customerId;
    customer.createdAt = existing && existing.createdAt ? existing.createdAt : new Date().toISOString();
    await updateCustomer(customer);
    savedId = customerId;
    showToast('顧客情報を更新しました');
  } else {
    // 重複チェック（新規登録のみ）：同名または電話番号一致で確認
    const existingCustomers = await getAllCustomers();
    const dupName = existingCustomers.find(c => c.name === name);
    const dupPhone = phone ? existingCustomers.find(c => (c.phone || '') === phone) : null;
    if (dupName || dupPhone) {
      const who = dupName || dupPhone;
      const kind = dupName ? '名前' : '電話番号';
      const proceed = confirm(
        `同じ${kind}の顧客「${who.name}」が既に登録されています。\n` +
        `「OK」＝別人として新規登録\n「キャンセル」＝既存の顧客を使う`
      );
      if (!proceed) {
        // 既存顧客を使う。予約起点ならその顧客を反映
        closeModal('customer-modal');
        if (fromReservation) await setSelectedCustomer(who.id);
        return;
      }
    }
    customer.createdAt = new Date().toISOString();
    savedId = await addCustomer(customer);
    showToast('顧客を登録しました');
  }

  await autoBackup();
  closeModal('customer-modal');
  renderCustomers();
  if (currentDetailCustomerId) showCustomerDetail(currentDetailCustomerId);
  // 予約入力中に顧客登録した場合、その顧客を予約に反映
  if (fromReservation) await setSelectedCustomer(savedId);
}

async function handleCustomerDelete() {
  const id = parseInt(document.getElementById('cust-id').value);
  if (!id || !confirm('顧客情報を削除しますか？（予約履歴は残ります）')) return;
  await deleteCustomer(id);
  await autoBackup();
  closeModal('customer-modal');
  await renderCustomers();
  showToast('顧客を削除しました');
}

async function showCustomerDetail(id) {
  currentDetailCustomerId = id;
  const customers    = await getAllCustomers();
  const reservations = await getAllReservations();
  const c = customers.find(x => x.id===id);
  if (!c) return;
  document.getElementById('detail-cust-name').textContent = c.name;
  const notes = c.note ? c.note.split('\n').map(line => `<li>${escapeHTML(line)}</li>`).join('') : '<li>なし</li>';
  document.getElementById('detail-cust-info').innerHTML = `
    <div>📞 ${escapeHTML(c.phone || 'なし')}</div>
    <div style="margin-top:8px;font-weight:700;font-size:12px;color:var(--muted);">メモ</div>
    <ul style="margin:4px 0 0 16px;font-size:12px;">${notes}</ul>
  `;
  const hist = reservations.filter(r=>r.customerId===id).sort((a,b)=>b.date.localeCompare(a.date));
  const histEl = document.getElementById('detail-reservation-history');
  histEl.innerHTML = hist.length ? '' : '<div style="color:var(--muted);font-size:13px;">履歴はありません</div>';
  hist.forEach(r => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-date">${r.date}　${r.startTime}</div>
      <div class="history-menu">${escapeHTML((r.menus || []).join('・'))}　${r.price?r.price.toLocaleString()+'円':''}</div>
    `;
    histEl.appendChild(div);
  });
  document.getElementById('customer-detail-modal').classList.add('open');
}

function openCustomerEditFromDetail() {
  closeModal('customer-detail-modal');
  openCustomerEdit(currentDetailCustomerId);
}

// ===== 設定・CSV =====
function renderMenuEditList() {
  const el = document.getElementById('menu-edit-list');
  if (!el) return;
  if (!menuList.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">メニューがありません。下のフォームから追加してください。</div>';
    return;
  }
  el.innerHTML = '';
  menuList.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'menu-edit-row';
    row.innerHTML = `
      <div class="me-order">
        <button type="button" class="me-ord-btn" ${idx === 0 ? 'disabled' : ''} onclick="moveMenuItem(${m.id},-1)" title="上へ">▲</button>
        <button type="button" class="me-ord-btn" ${idx === menuList.length - 1 ? 'disabled' : ''} onclick="moveMenuItem(${m.id},1)" title="下へ">▼</button>
      </div>
      <input class="me-input me-name" type="text" value="${escapeHTML(m.label)}" onchange="updateMenuItem(${m.id},'label',this.value)" placeholder="メニュー名">
      <input class="me-input me-time" type="number" min="1" step="5" value="${m.time}" onchange="updateMenuItem(${m.id},'time',this.value)" title="所要時間(分)">
      <input class="me-input me-price" type="number" min="0" step="100" value="${m.price || 0}" onchange="updateMenuItem(${m.id},'price',this.value)" title="料金(円)">
      <button type="button" class="me-del" onclick="deleteMenuItem(${m.id})" title="削除">✕</button>
    `;
    el.appendChild(row);
  });
}

async function addMenuItem() {
  const nameEl = document.getElementById('new-menu-name');
  const timeEl = document.getElementById('new-menu-time');
  const priceEl = document.getElementById('new-menu-price');
  const name = nameEl.value.trim();
  const time = parseInt(timeEl.value, 10);
  const price = Math.max(0, parseInt(priceEl.value, 10) || 0);
  if (!name) { alert('メニュー名を入力してください'); return; }
  if (!Number.isFinite(time) || time <= 0) { alert('所要時間を正しく入力してください（1分以上）'); return; }
  if (menuList.some(m => m.label === name)) {
    if (!confirm(`「${name}」は既に存在します。それでも追加しますか？`)) return;
  }
  const maxOrder = menuList.reduce((mx, m) => Math.max(mx, valueOrDefault(m.order, 0)), -1);
  await addMenu({ label: name, time, price, order: maxOrder + 1 });
  await loadMenus();
  buildMenuGrid();
  renderMenuEditList();
  nameEl.value = ''; timeEl.value = ''; priceEl.value = '';
  await autoBackup();
  showToast('メニューを追加しました');
}

async function updateMenuItem(id, field, value) {
  const m = menuList.find(x => x.id === id);
  if (!m) return;
  if (field === 'label') {
    const name = String(value).trim();
    if (!name) { showToast('メニュー名は空にできません'); renderMenuEditList(); return; }
    m.label = name;
  } else if (field === 'time') {
    const t = parseInt(value, 10);
    if (!Number.isFinite(t) || t <= 0) { showToast('所要時間は1分以上にしてください'); renderMenuEditList(); return; }
    m.time = t;
  } else if (field === 'price') {
    m.price = Math.max(0, parseInt(value, 10) || 0);
  }
  await updateMenu(m);
  buildMenuGrid(); // 予約画面のメニュー時間を最新化（フォーカスは保つため一覧は再描画しない）
  await autoBackup();
  showToast('メニューを更新しました');
}

async function deleteMenuItem(id) {
  const m = menuList.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`「${m.label}」を削除しますか？\n（このメニューを使った過去の予約データはそのまま残ります）`)) return;
  await deleteMenu(id);
  await loadMenus();
  buildMenuGrid();
  renderMenuEditList();
  await autoBackup();
  showToast('メニューを削除しました');
}

async function moveMenuItem(id, dir) {
  const idx = menuList.findIndex(x => x.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= menuList.length) return;
  const a = menuList[idx], b = menuList[swapIdx];
  const ao = valueOrDefault(a.order, idx), bo = valueOrDefault(b.order, swapIdx);
  a.order = bo; b.order = ao;
  await updateMenu(a);
  await updateMenu(b);
  await loadMenus();
  buildMenuGrid();
  renderMenuEditList();
  await autoBackup();
}

// --- CSV共通 ---
function csvEscape(value) {
  const text = String(valueOrDefault(value, ''));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.replace(/\r$/, ''));
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(cols => {
    const row = {};
    headers.forEach((header, index) => { row[header] = valueOrDefault(cols[index], ''); });
    return row;
  });
}

// --- 予約CSV エクスポート ---
async function exportReservationsCSV() {
  const reservations = await getAllReservations();
  const customers = await getAllCustomers();
  const lines = ['id,date,startTime,duration,menus,price,customerId,customerName,customerPhone,color'];
  reservations
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .forEach(r => {
      const c = customers.find(x => x.id === r.customerId);
      lines.push([
        r.id, r.date, r.startTime, r.duration,
        (r.menus || []).join('/'),
        r.price || 0, r.customerId || '',
        c ? c.name : '',
        c ? (c.phone || '') : '',
        safeColor(r.color)
      ].map(csvEscape).join(','));
    });
  downloadFile('\uFEFF' + lines.join('\r\n') + '\r\n', `reservations_${todayStr()}.csv`, 'text/csv;charset=utf-8;');
  showToast('予約CSVをダウンロードしました');
}

// --- 顧客CSV エクスポート ---
async function exportCustomersCSV() {
  const customers = await getAllCustomers();
  const lines = ['id,name,phone,note,createdAt,updatedAt'];
  customers.forEach(c => {
    lines.push([
      c.id, c.name || '', c.phone || '', c.note || '', c.createdAt || '', c.updatedAt || ''
    ].map(csvEscape).join(','));
  });
  downloadFile('\uFEFF' + lines.join('\r\n') + '\r\n', `customers_${todayStr()}.csv`, 'text/csv;charset=utf-8;');
  showToast('顧客CSVをダウンロードしました');
}

function isIOSLikeDevice() {
  const ua = navigator.userAgent || '';
  // iPadOS 13以降はMacintoshと表示されることがあるため、タッチ点数も見る
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function normalizeMimeType(mimeType) {
  return String(mimeType || 'text/plain').split(';')[0] || 'text/plain';
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], {type: mimeType});

  // iPad/iPhone Safari・ホーム画面PWAでは、Blobの自動ダウンロードが失敗して
  // 画面が読み込み中のままになることがある。ユーザー操作のボタンから保存させる。
  if (isIOSLikeDevice()) {
    showIOSSaveDialog(content, filename, mimeType);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari系では即時revokeでダウンロードがキャンセルされることがあるため遅らせる
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function showIOSSaveDialog(content, filename, mimeType) {
  const old = document.getElementById('ios-save-dialog');
  if (old) old.remove();

  const cleanType = normalizeMimeType(mimeType);
  const blob = new Blob([content], {type: cleanType});
  const url = URL.createObjectURL(blob);
  const file = new File([blob], filename, {type: cleanType});
  const canShareFile = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));

  const backdrop = document.createElement('div');
  backdrop.id = 'ios-save-dialog';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;';

  const card = document.createElement('div');
  card.style.cssText = 'width:min(480px,100%);background:#fff;border-radius:22px;padding:20px;box-shadow:0 20px 45px rgba(0,0,0,.25);font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#263238;';
  card.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:18px;">iPad用ファイル保存</h3>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:#546e7a;">
      iPadでは自動ダウンロードが止まることがあるため、この画面から保存してください。
      ファイル名：<strong>${escapeHTML(filename)}</strong>
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;margin:14px 0;">
      ${canShareFile ? '<button type="button" id="ios-share-file-btn" class="btn btn-primary" style="width:100%;">共有メニューで保存</button>' : ''}
      <a id="ios-open-file-link" href="${url}" download="${escapeHTML(filename)}" target="_blank" rel="noopener" class="btn btn-success" style="display:block;text-align:center;text-decoration:none;">ファイルを開く / 保存</a>
      <button type="button" id="ios-copy-file-btn" class="btn" style="width:100%;background:#eceff1;color:#263238;">内容をコピー</button>
    </div>
    <p style="margin:0 0 14px;font-size:12px;line-height:1.7;color:#78909c;">
      「共有メニューで保存」が使える場合は、そこから「ファイルに保存」を選んでください。
      開いた場合は、共有ボタンから「ファイルに保存」を選べます。
    </p>
    <button type="button" id="ios-save-close-btn" class="btn btn-sm" style="width:100%;background:#b0bec5;color:#fff;">閉じる</button>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  const cleanup = () => {
    URL.revokeObjectURL(url);
    backdrop.remove();
  };

  const shareBtn = document.getElementById('ios-share-file-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file], title: filename });
        showToast('共有メニューを開きました');
      } catch (error) {
        if (error && error.name !== 'AbortError') {
          alert('共有メニューを開けませんでした。「ファイルを開く / 保存」を試してください。');
        }
      }
    });
  }

  const copyBtn = document.getElementById('ios-copy-file-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(content);
        showToast('バックアップ内容をコピーしました');
      } catch (error) {
        alert('コピーできませんでした。「ファイルを開く / 保存」を試してください。');
      }
    });
  }

  document.getElementById('ios-save-close-btn').addEventListener('click', cleanup);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) cleanup();
  });
}

// --- 予約CSV インポート ---
function importReservationsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { alert('データが見つかりません'); return; }
      const headers = rows[0].map(h => String(h || '').trim());
      if (!headers.includes('date') || !headers.includes('startTime')) {
        alert('予約CSVの形式が正しくありません。date列とstartTime列が必要です。');
        return;
      }
      let count = 0, skipped = 0;
      for (const row of rowsToObjects(rows)) {
        const duration = parseInt(row.duration, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ||
            !/^\d{2}:\d{2}$/.test(row.startTime || '') ||
            !Number.isFinite(duration) || duration <= 0) {
          skipped++;
          continue;
        }
        const parsedId = parseInt(row.id, 10);
        const res = {
          date: row.date,
          startTime: row.startTime,
          duration,
          menus: row.menus ? row.menus.split('/').filter(Boolean) : [],
          price: Math.max(0, parseInt(row.price, 10) || 0),
          customerId: parseInt(row.customerId, 10) || null,
          color: safeColor(row.color),
        };
        if (Number.isInteger(parsedId) && parsedId > 0) {
          res.id = parsedId;
          await updateReservation(res);
        } else {
          await addReservation(res);
        }
        count++;
      }
      await autoBackup();
      await renderTodayPanel();
      await renderWeekView();
      if (document.getElementById('day-view-section').classList.contains('active')) {
        await renderTimeline(selectedDate);
      }
      refreshCalendar();
      showToast(`${count}件の予約をインポートしました${skipped ? `（${skipped}件スキップ）` : ''}`);
    } catch (error) {
      console.error(error);
      alert('予約CSVの読み込みに失敗しました。ファイル内容を確認してください。');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('CSVファイルを読み込めませんでした。');
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

// --- 顧客CSV インポート ---
function importCustomersCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const rows = parseCSV(e.target.result);
      if (rows.length < 2) { alert('データが見つかりません'); return; }
      const headers = rows[0].map(h => String(h || '').trim());
      if (!headers.includes('name')) {
        alert('顧客CSVの形式が正しくありません。name列が必要です。');
        return;
      }
      let count = 0, skipped = 0;
      for (const row of rowsToObjects(rows)) {
        const name = String(row.name || '').trim();
        if (!name) { skipped++; continue; }
        const parsedId = parseInt(row.id, 10);
        const cust = {
          name,
          phone: row.phone || '',
          note: row.note || '',
          createdAt: row.createdAt || new Date().toISOString(),
          updatedAt: row.updatedAt || new Date().toISOString(),
        };
        if (Number.isInteger(parsedId) && parsedId > 0) {
          cust.id = parsedId;
          await updateCustomer(cust);
        } else {
          await addCustomer(cust);
        }
        count++;
      }
      await autoBackup();
      await renderCustomers();
      showToast(`${count}件の顧客をインポートしました${skipped ? `（${skipped}件スキップ）` : ''}`);
    } catch (error) {
      console.error(error);
      alert('顧客CSVの読み込みに失敗しました。ファイル内容を確認してください。');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('CSVファイルを読み込めませんでした。');
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

// ===== ユーティリティ =====
function showSection(id, btn) {
  document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (id==='calendar') { refreshCalendar(); renderTodayPanel(); renderWeekView(); }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'customer-modal') reopenReservationAfterCustomer = false;
  // 顧客詳細を閉じたら選択中IDを解除（次回の顧客登録で無関係な詳細が開くのを防ぐ）
  if (id === 'customer-detail-modal') currentDetailCustomerId = null;
}

document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => {
    if (e.target === bd) {
      bd.classList.remove('open');
      if (bd.id === 'customer-modal') reopenReservationAfterCustomer = false;
      if (bd.id === 'customer-detail-modal') currentDetailCustomerId = null;
    }
  });
});

// ===== データ全削除 =====
async function deleteAllReservations() {
  const count = (await getAllReservations()).length;
  if (count === 0) { alert('予約データはありません。'); return; }
  if (!confirm(`予約データ ${count} 件をすべて削除します。\nこの操作は元に戻せません。\nよろしいですか？`)) return;
  await clearReservations();
  await autoBackup();
  alert('予約データをすべて削除しました。');
  await renderTodayPanel();
  await renderWeekView();
  if (document.getElementById('day-view-section').classList.contains('active')) {
    await renderTimeline(selectedDate);
  }
  refreshCalendar();
}

async function deleteAllCustomers() {
  const count = (await getAllCustomers()).length;
  if (count === 0) { alert('顧客データはありません。'); return; }
  if (!confirm(`顧客データ ${count} 件をすべて削除します。\n予約データは残り、予約上では「顧客不明」と表示されます。\nこの操作は元に戻せません。\nよろしいですか？`)) return;
  await clearCustomers();
  await autoBackup();
  alert('顧客データをすべて削除しました。');
  await renderCustomers();
  await renderTodayPanel();
  await renderWeekView();
  if (document.getElementById('day-view-section').classList.contains('active')) {
    await renderTimeline(selectedDate);
  }
  refreshCalendar();
}

async function autoBackup() {
  try {
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    const menus = await getAllMenus();
    localStorage.setItem('barber_auto_backup', JSON.stringify({
      reservations, customers, menus, timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.warn('自動バックアップを保存できませんでした:', error);
  }
}


async function exportFullBackup() {
  try {
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    const menus = await getAllMenus();
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    const backup = {
      app: 'barber-reservation',
      version: '1.1.0',
      exportedAt: now.toISOString(),
      counts: {
        reservations: reservations.length,
        customers: customers.length,
        menus: menus.length,
      },
      reservations,
      customers,
      menus,
    };
    downloadFile(JSON.stringify(backup, null, 2), `barber_backup_${stamp}.json`, 'application/json;charset=utf-8;');
    showToast('顧客・予約を一括バックアップしました');
  } catch (error) {
    console.error(error);
    alert('バックアップの作成に失敗しました。');
  }
}

function importFullBackupJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || !Array.isArray(data.customers) || !Array.isArray(data.reservations)) {
        alert('一括バックアップJSONの形式が正しくありません。');
        return;
      }
      const resCount = data.reservations.length;
      const custCount = data.customers.length;
      const menuCount = Array.isArray(data.menus) ? data.menus.length : 0;
      if (!confirm(`バックアップを読み込みます。\n顧客 ${custCount} 件、予約 ${resCount} 件${menuCount ? `、施術メニュー ${menuCount} 件` : ''} を現在のデータに上書きします。\nよろしいですか？`)) {
        return;
      }

      await clearCustomers();
      await clearReservations();
      if (Array.isArray(data.menus)) await clearMenus();

      for (const c of data.customers) {
        const item = {
          name: String(c.name || '').trim(),
          phone: c.phone || '',
          note: c.note || '',
          createdAt: c.createdAt || new Date().toISOString(),
          updatedAt: c.updatedAt || new Date().toISOString(),
        };
        if (!item.name) continue;
        const parsedId = parseInt(c.id, 10);
        if (Number.isInteger(parsedId) && parsedId > 0) item.id = parsedId;
        await updateCustomer(item);
      }

      for (const r of data.reservations) {
        const duration = parseInt(r.duration, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ||
            !/^\d{2}:\d{2}$/.test(r.startTime || '') ||
            !Number.isFinite(duration) || duration <= 0) {
          continue;
        }
        const item = {
          date: r.date,
          startTime: r.startTime,
          duration,
          menus: Array.isArray(r.menus) ? r.menus.map(String) : [],
          price: Math.max(0, parseInt(r.price, 10) || 0),
          customerId: parseInt(r.customerId, 10) || null,
          color: safeColor(r.color),
        };
        const parsedId = parseInt(r.id, 10);
        if (Number.isInteger(parsedId) && parsedId > 0) item.id = parsedId;
        await updateReservation(item);
      }

      if (Array.isArray(data.menus)) {
        for (let i = 0; i < data.menus.length; i++) {
          const m = data.menus[i];
          const label = String(m.label || '').trim();
          const time = parseInt(m.time, 10);
          if (!label || !Number.isFinite(time) || time <= 0) continue;
          const item = {
            label,
            time,
            price: Math.max(0, parseInt(m.price, 10) || 0),
            order: Number.isFinite(parseInt(m.order, 10)) ? parseInt(m.order, 10) : i,
          };
          const parsedId = parseInt(m.id, 10);
          if (Number.isInteger(parsedId) && parsedId > 0) item.id = parsedId;
          await updateMenu(item);
        }
        await loadMenus();
        buildMenuGrid();
        renderMenuEditList();
      }

      await autoBackup();
      await renderCustomers();
      await renderTodayPanel();
      await renderWeekView();
      if (document.getElementById('day-view-section').classList.contains('active')) {
        await renderTimeline(selectedDate);
      }
      refreshCalendar();
      showToast('一括バックアップを読み込みました');
    } catch (error) {
      console.error(error);
      alert('一括バックアップの読み込みに失敗しました。ファイル内容を確認してください。');
    } finally {
      event.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('バックアップファイルを読み込めませんでした。');
    event.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}
