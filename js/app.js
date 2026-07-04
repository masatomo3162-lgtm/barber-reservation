// ===== 定数 =====
const WEEKDAYS = ['日','月','火','水','木','金','土'];
const START_HOUR = 8;
const END_HOUR   = 19;
const PX_PER_MIN = 3;
const INTERVAL   = 5;

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

// ===== 状態 =====
let calendar;
let selectedDate      = todayStr();
let dragOffsetMin     = 0;
let currentDetailId   = null;   // 予約詳細モーダル用
let currentDetailCustomerId = null;

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  initCalendar();
  buildMenuGrid();
  buildMenuDisplay();
  renderCustomers();
  renderTodayPanel();
  renderWeekView();
  document.getElementById('customer-search')
    .addEventListener('input', e => renderCustomers(e.target.value));
});

// ===== ユーティリティ =====
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
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
  return `${String(Math.floor(tot/60)).padStart(2,'0')}:${String(tot%60).padStart(2,'0')}`;
}
function calcEndISO(date, start, durMin) {
  const [h,m] = start.split(':').map(Number);
  const d = new Date(date+'T00:00:00');
  d.setHours(h, m+durMin);
  // ローカル時刻でISO文字列を生成（UTCズレを防ぐ）
  const yy = d.getFullYear();
  const mo = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
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
  return String(value ?? '')
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

async function findReservationConflict(date, startTime, duration, ignoreId = null) {
  const start = timeToMin(startTime);
  const end = start + duration + INTERVAL;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
  const reservations = await getAllReservations();
  return reservations.find(r => {
    if (r.date !== date || r.id === ignoreId) return false;
    const otherStart = timeToMin(r.startTime);
    const otherDuration = Number(r.duration) || 0;
    const otherEnd = otherStart + otherDuration + INTERVAL;
    return Number.isFinite(otherStart) && start < otherEnd && end > otherStart;
  }) || null;
}

function refreshCalendar() {
  if (calendar) calendar.refetchEvents();
}

// ===== TODAY パネル =====
async function renderTodayPanel() {
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
        title: r.menus[0] || '',
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

  // ===== 空き時間バー（9:00〜18:00）=====
  const OPEN_START = (9  - START_HOUR) * 60;  // 9:00 → min from START_HOUR
  const OPEN_END   = (19 - START_HOUR) * 60;  // 19:00
  // 予約のブロック（施術+インターバル）をリスト化
  const busySlots = dayRes.map(r => {
    const s = timeToMin(r.startTime);
    return { s, e: s + r.duration + INTERVAL };
  });
  // 空き時間を算出
  const freeSlots = [];
  let cursor = OPEN_START;
  const sortedBusy = busySlots.filter(b => b.e > OPEN_START && b.s < OPEN_END)
    .sort((a,b) => a.s - b.s);
  for (const b of sortedBusy) {
    const blockStart = Math.max(b.s, OPEN_START);
    if (cursor < blockStart) freeSlots.push({ s: cursor, e: blockStart });
    cursor = Math.max(cursor, b.e);
  }
  if (cursor < OPEN_END) freeSlots.push({ s: cursor, e: OPEN_END });

  // 空き時間バーを描画
  freeSlots.forEach(slot => {
    const top    = minToPx(slot.s);
    const height = minToPx(slot.e - slot.s);
    if (height < 1) return;
    const bar = document.createElement('div');
    bar.className = 'free-slot';
    bar.style.cssText = `top:${top}px;height:${height}px;`;
    const label = document.createElement('div');
    label.className = 'free-slot-label';
    const dur = slot.e - slot.s;
    label.textContent = dur >= 15 ? `空き ${minToTime(slot.s)}〜${minToTime(slot.e)}（${dur}分）` : '';
    bar.appendChild(label);
    resArea.appendChild(bar);
  });

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
      block.style.cssText = `top:${top}px;height:${height}px;background:${safeColor(r.color)};color:#fff;border-left-color:rgba(0,0,0,0.28);`;
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
      resArea.appendChild(block);
    });

  resArea.addEventListener('dragover', e => {
    e.preventDefault();
    const rect = resArea.getBoundingClientRect();
    const snapped = Math.round((pxToMin(e.clientY-rect.top)-dragOffsetMin)/5)*5;
    const clamped = Math.max(0, Math.min(snapped, totalMin-10));
    const ind = document.getElementById('drag-indicator');
    ind.textContent = minToTime(clamped);
    ind.style.left = (e.clientX+14)+'px';
    ind.style.top  = (e.clientY-14)+'px';
  });

  resArea.addEventListener('drop', async e => {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData('text/plain'));
    const rect = resArea.getBoundingClientRect();
    const snapped = Math.round((pxToMin(e.clientY-rect.top)-dragOffsetMin)/5)*5;
    const all = await getAllReservations();
    const res = all.find(r => r.id === id);
    if (res) {
      const maxStart = Math.max(0, totalMin - ((Number(res.duration) || 0) + INTERVAL));
      const clamped = Math.max(0, Math.min(snapped, maxStart));
      const newStartTime = minToTime(clamped);
      const conflict = await findReservationConflict(date, newStartTime, Number(res.duration) || 0, id);
      if (conflict) {
        alert(`その時間には別の予約があります（${conflict.startTime}開始）。`);
        await renderTimeline(date);
      } else {
        res.startTime = newStartTime;
        await updateReservation(res);
        await autoBackup();
        await renderTimeline(date);
        await renderTodayPanel();
        await renderWeekView();
        refreshCalendar();
      }
    }
    document.getElementById('drag-indicator').style.display = 'none';
  });

  document.getElementById('timeline-scroll').scrollTop = minToPx(timeToMin('09:00'))-40;
}

// ===== 予約編集モーダル =====
function buildMenuGrid() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = '';
  MENUS.forEach(m => {
    const item = document.createElement('label');
    item.className = 'menu-item';
    item.innerHTML = `
      <input type="checkbox" name="menu" value="${m.key}" data-time="${m.time}" data-label="${m.label}">
      <div><div class="menu-item-name">${m.label}</div><div class="menu-item-time">${m.time}分</div></div>
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
  renderCustomerSelect();
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
  await renderCustomerSelect(res.customerId);
  document.getElementById('reservation-modal').classList.add('open');
}

async function renderCustomerSelect(selectedId) {
  const customers = await getAllCustomers();
  const sel = document.getElementById('res-customer-id');
  sel.innerHTML = '<option value="">顧客を選択してください</option>';
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.phone ? ` （${c.phone}）` : '');
    if (c.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
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
    alert(`その時間には別の予約があります（${conflict.startTime}開始）。`);
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
  const normalizedFilter = String(filter || '').toLowerCase();
  list.innerHTML = '';

  customers
    .filter(c => String(c.name || '').toLowerCase().includes(normalizedFilter) ||
      String(c.phone || '').toLowerCase().includes(normalizedFilter))
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
  const id = document.getElementById('cust-id').value;
  const customer = {
    name: document.getElementById('cust-name').value,
    phone: document.getElementById('cust-phone').value,
    note: document.getElementById('cust-note').value,
    updatedAt: new Date().toISOString(),
  };
  if (id) {
    const customerId = parseInt(id, 10);
    const existingCustomers = await getAllCustomers();
    const existing = existingCustomers.find(c => c.id === customerId);
    customer.id = customerId;
    customer.createdAt = existing && existing.createdAt ? existing.createdAt : new Date().toISOString();
    await updateCustomer(customer);
    showToast('顧客情報を更新しました');
  } else {
    customer.createdAt = new Date().toISOString();
    await addCustomer(customer);
    showToast('顧客を登録しました');
  }
  await autoBackup();
  closeModal('customer-modal');
  renderCustomers();
  if (currentDetailCustomerId) showCustomerDetail(currentDetailCustomerId);
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
function buildMenuDisplay() {
  const el = document.getElementById('menu-list-display');
  el.innerHTML = MENUS.map(m=>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span>${m.label}</span><span style="color:var(--muted);">${m.time}分</span></div>`
  ).join('') + `<div style="padding:6px 0;font-size:13px;color:var(--muted);">インターバル: ${INTERVAL}分</div>`;
}

// --- CSV共通 ---
function csvEscape(value) {
  const text = String(value ?? '');
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
    headers.forEach((header, index) => { row[header] = cols[index] ?? ''; });
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

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
}

document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target===bd) bd.classList.remove('open'); });
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
    localStorage.setItem('barber_auto_backup', JSON.stringify({
      reservations, customers, timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.warn('自動バックアップを保存できませんでした:', error);
  }
}
