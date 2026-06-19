let calendar;
let selectedDate = new Date().toISOString().split('T')[0];
let currentDetailCustomerId = null;

document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initCalendar();
    renderCustomers();
    setupEventListeners();
});

function initCalendar() {
    const calendarEl = document.getElementById('calendar-view');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ja',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridOneWeek'
        },
        views: {
            timeGridOneWeek: {
                type: 'timeGrid',
                duration: { days: 7 },
                buttonText: 'WEEK',
                // 今日から表示するように設定
                visibleRange: function(currentDate) {
                    return {
                        start: currentDate,
                        end: new Date(currentDate.valueOf() + 7 * 24 * 60 * 60 * 1000)
                    };
                }
            }
        },
        // 高速化のための設定
        lazyFetching: true,
        dayMaxEvents: true,
        dateClick: function(info) {
            openDayView(info.dateStr);
        },
        eventClick: function(info) {
            const date = info.event.startStr.split('T')[0];
            openDayView(date);
        },
        events: async function(fetchInfo, successCallback, failureCallback) {
            const reservations = await getAllReservations();
            const events = reservations.map(r => ({
                id: r.id,
                title: r.menus.join(', '),
                start: `${r.date}T${r.startTime}`,
                end: calculateEndTimeISO(r.date, r.startTime, r.duration),
                backgroundColor: r.color || '#e67e22',
                textColor: '#333'
            }));
            successCallback(events);
        }
    });
    calendar.render();
}

function getRandomPastelColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
}

function openDayView(date) {
    selectedDate = date;
    document.getElementById('calendar-view').style.display = 'none';
    document.getElementById('day-view').style.display = 'block';
    document.getElementById('selected-date-display').textContent = date;
    renderTimeline(date);
}

function backToCalendar() {
    document.getElementById('calendar-view').style.display = 'block';
    document.getElementById('day-view').style.display = 'none';
    calendar.refetchEvents();
}

async function renderTimeline(date) {
    const timeline = document.getElementById('reservation-timeline');
    const indicator = document.getElementById('drag-time-indicator');
    timeline.innerHTML = '';
    
    for (let h = 8; h <= 20; h++) {
        const slot = document.createElement('div');
        slot.className = 'timeline-slot';
        slot.style.top = `${(h - 8) * 60}px`;
        slot.style.height = '60px';
        slot.textContent = `${h}:00`;
        timeline.appendChild(slot);
    }

    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    const filtered = reservations.filter(r => r.date === date);

    filtered.forEach(r => {
        const customer = customers.find(c => c.id === r.customerId);
        const [h, m] = r.startTime.split(':').map(Number);
        const top = (h - 8) * 60 + m;
        const height = r.duration;

        const block = document.createElement('div');
        block.className = 'reservation-block';
        block.style.top = `${top}px`;
        block.style.height = `${height}px`;
        block.style.backgroundColor = r.color || getRandomPastelColor();
        block.style.color = '#333';
        block.draggable = true;
        block.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <strong>${r.startTime} - ${customer ? customer.name : '客'}</strong>
                <button onclick="editReservation(${r.id})" style="padding:2px 5px; font-size:10px; background:rgba(255,255,255,0.5); border:1px solid #999; color:#333; cursor:pointer;">編集</button>
            </div>
            <div style="font-size:0.9em;">${r.menus.join(', ')} (${r.price || 0}円)</div>
        `;

        block.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', r.id);
            block.classList.add('dragging');
            indicator.style.display = 'block';
        });

        block.addEventListener('dragend', () => {
            block.classList.remove('dragging');
            indicator.style.display = 'none';
        });

        timeline.appendChild(block);
    });

    timeline.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = timeline.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const totalMinutes = Math.round(y / 5) * 5;
        const h = Math.floor(totalMinutes / 60) + 8;
        const m = totalMinutes % 60;
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        
        indicator.textContent = timeStr;
        indicator.style.top = `${e.clientY - rect.top - 25}px`;
        indicator.style.left = `${e.clientX - rect.left + 10}px`;
    });

    timeline.addEventListener('drop', async (e) => {
        e.preventDefault();
        const id = parseInt(e.dataTransfer.getData('text/plain'));
        const rect = timeline.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const totalMinutes = Math.round(y / 5) * 5;
        const h = Math.floor(totalMinutes / 60) + 8;
        const m = totalMinutes % 60;
        const newStartTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

        const reservations = await getAllReservations();
        const res = reservations.find(r => r.id === id);
        if (res) {
            res.startTime = newStartTime;
            await updateReservation(res);
            autoBackup(); // 自動バックアップ
            renderTimeline(date);
        }
    });
}

async function editReservation(id) {
    const reservations = await getAllReservations();
    const res = reservations.find(r => r.id === id);
    if (!res) return;

    document.getElementById('reservation-modal-title').textContent = '予約変更登録';
    document.getElementById('res-id').value = res.id;
    document.getElementById('res-customer-id').value = res.customerId;
    document.getElementById('res-start-time').value = res.startTime;
    document.getElementById('res-price').value = res.price || 0;
    document.getElementById('res-delete-btn').style.display = 'inline-block';
    
    document.querySelectorAll('input[name="menu"]').forEach(cb => {
        const menuLabel = cb.parentNode.textContent.trim();
        cb.checked = res.menus.includes(menuLabel);
    });
    
    updateTotalTime();
    document.getElementById('reservation-modal').style.display = 'block';
}

function updateTotalTime() {
    const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
    const total = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
    document.getElementById('res-total-time').textContent = total;
}

async function handleReservationDeleteFromModal() {
    const id = parseInt(document.getElementById('res-id').value);
    if (id && confirm('この予約を取り消しますか？')) {
        await deleteReservation(id);
        autoBackup();
        closeModal('reservation-modal');
        renderTimeline(selectedDate);
        calendar.refetchEvents();
    }
}

function setupEventListeners() {
    document.getElementById('customer-search').addEventListener('input', (e) => {
        renderCustomers(e.target.value);
    });

    document.getElementById('customer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('cust-id').value;
        const customer = {
            name: document.getElementById('cust-name').value,
            phone: document.getElementById('cust-phone').value,
            note: document.getElementById('cust-note').value,
            updatedAt: new Date().toISOString()
        };

        if (id) {
            customer.id = parseInt(id);
            await updateCustomer(customer);
        } else {
            customer.createdAt = new Date().toISOString();
            await addCustomer(customer);
        }
        
        autoBackup();
        closeModal('customer-modal');
        renderCustomers();
        if (currentDetailCustomerId) showCustomerDetail(currentDetailCustomerId);
        e.target.reset();
    });

    document.getElementById('reservation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('res-id').value;
        const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
        const menus = Array.from(checkboxes).map(cb => cb.parentNode.textContent.trim());
        const totalMinutes = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
        
        const reservationData = {
            customerId: parseInt(document.getElementById('res-customer-id').value),
            date: selectedDate,
            startTime: document.getElementById('res-start-time').value,
            duration: totalMinutes,
            menus: menus,
            price: parseInt(document.getElementById('res-price').value) || 0,
            interval: 5
        };

        if (id) {
            const reservations = await getAllReservations();
            const existing = reservations.find(r => r.id === parseInt(id));
            reservationData.id = parseInt(id);
            reservationData.color = existing.color;
            await updateReservation(reservationData);
        } else {
            reservationData.color = getRandomPastelColor();
            await addReservation(reservationData);
        }
        
        autoBackup();
        closeModal('reservation-modal');
        renderTimeline(selectedDate);
        renderCustomers();
        e.target.reset();
        document.getElementById('res-id').value = '';
    });

    document.querySelectorAll('input[name="menu"]').forEach(cb => {
        cb.addEventListener('change', updateTotalTime);
    });
}

async function renderCustomers(filter = '') {
    const customers = await getAllCustomers();
    const reservations = await getAllReservations();
    const list = document.getElementById('customer-list');
    const select = document.getElementById('res-customer-id');
    
    list.innerHTML = '';
    select.innerHTML = '<option value="">顧客を選択してください</option>';
    
    const filteredCustomers = customers.filter(c => 
        c.name.includes(filter) || (c.phone && c.phone.includes(filter))
    );

    filteredCustomers.forEach(c => {
        const customerRes = reservations.filter(r => r.customerId === c.id)
            .sort((a, b) => b.date.localeCompare(a.date));
        
        const lastVisit = customerRes.length > 0 ? customerRes[0].date : 'なし';
        let daysAgoText = '';
        if (customerRes.length > 0) {
            const diff = Math.floor((new Date() - new Date(customerRes[0].date)) / (1000 * 60 * 60 * 24));
            daysAgoText = `<br><span class="days-ago">${diff}日前</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><a href="#" onclick="showCustomerDetail(${c.id}); return false;" style="color:var(--primary-color); font-weight:bold; text-decoration:none;">${c.name}</a></td>
            <td>${c.phone}</td>
            <td>${lastVisit}${daysAgoText}</td>
            <td>
                <button onclick="openCustomerEdit(${c.id})" style="background:#3498db; padding:5px 10px; font-size:12px;">編集</button>
            </td>
        `;
        list.appendChild(tr);
        
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
    });
}

async function showCustomerDetail(id) {
    currentDetailCustomerId = id;
    const customers = await getAllCustomers();
    const reservations = await getAllReservations();
    const customer = customers.find(c => c.id === id);
    if (!customer) return;

    document.getElementById('detail-cust-name').textContent = customer.name;
    document.getElementById('detail-cust-info').innerHTML = `
        <div><strong>電話番号:</strong> ${customer.phone || 'なし'}</div>
        <div style="margin-top:10px;"><strong>メモ:</strong></div>
        <ul class="memo-list">${customer.note ? customer.note.split('\n').map(line => `<li>${line}</li>`).join('') : 'なし'}</ul>
    `;

    const history = reservations.filter(r => r.customerId === id)
        .sort((a, b) => b.date.localeCompare(a.date));
    
    const historyList = document.getElementById('detail-reservation-history');
    historyList.innerHTML = history.length > 0 ? '' : '履歴はありません。';
    
    history.forEach(r => {
        const div = document.createElement('div');
        div.className = 'customer-history-item';
        div.innerHTML = `
            <div style="font-weight:bold;">${r.date} ${r.startTime}</div>
            <div style="font-size:0.9em;">メニュー: ${r.menus.join(', ')}</div>
            <div style="font-size:0.9em; color:#666;">料金: ${r.price || 0}円</div>
        `;
        historyList.appendChild(div);
    });

    document.getElementById('customer-detail-modal').style.display = 'block';
}

async function openCustomerEdit(id) {
    const customers = await getAllCustomers();
    const customer = customers.find(c => c.id === id);
    if (!customer) return;

    document.getElementById('customer-modal-title').textContent = '顧客情報編集';
    document.getElementById('cust-id').value = customer.id;
    document.getElementById('cust-name').value = customer.name;
    document.getElementById('cust-phone').value = customer.phone || '';
    document.getElementById('cust-note').value = customer.note || '';
    document.getElementById('cust-delete-btn').style.display = 'inline-block';
    document.getElementById('customer-modal').style.display = 'block';
}

function openCustomerEditFromDetail() {
    closeModal('customer-detail-modal');
    openCustomerEdit(currentDetailCustomerId);
}

async function handleCustomerDeleteFromModal() {
    const id = parseInt(document.getElementById('cust-id').value);
    if (id && confirm('顧客情報を削除しますか？（予約履歴は残ります）')) {
        await deleteCustomer(id);
        autoBackup();
        closeModal('customer-modal');
        renderCustomers();
    }
}

function calculateEndTimeISO(date, start, duration) {
    const [hours, minutes] = start.split(':').map(Number);
    const d = new Date(date);
    d.setHours(hours, minutes + duration);
    return d.toISOString();
}

function showSection(sectionId) {
    document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    if (sectionId === 'calendar') {
        calendar.refetchEvents();
    }
}

function openReservationModal() {
    document.getElementById('reservation-modal-title').textContent = '新規予約登録';
    document.getElementById('res-id').value = '';
    document.getElementById('reservation-form').reset();
    document.getElementById('res-start-time').value = "09:00";
    document.getElementById('res-total-time').textContent = '0';
    document.getElementById('res-delete-btn').style.display = 'none';
    document.getElementById('reservation-modal').style.display = 'block';
}

function openCustomerModal() {
    document.getElementById('customer-modal-title').textContent = '新規顧客登録';
    document.getElementById('cust-id').value = '';
    document.getElementById('customer-form').reset();
    document.getElementById('cust-delete-btn').style.display = 'none';
    document.getElementById('customer-modal').style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function deleteCustomer(id) {
    const transaction = db.transaction(['customers'], 'readwrite');
    const store = transaction.objectStore('customers');
    await store.delete(id);
}

// 自動バックアップ機能
async function autoBackup() {
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    const data = { reservations, customers, timestamp: new Date().toISOString() };
    localStorage.setItem('barber_auto_backup', JSON.stringify(data));
    console.log('Auto-backup saved to LocalStorage');
}

async function exportToCSV() {
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    let csv = 'ID,日付,開始時間,所要時間,メニュー,料金,顧客名,電話番号\n';
    reservations.forEach(r => {
        const c = customers.find(cust => cust.id === r.customerId);
        csv += `${r.id},${r.date},${r.startTime},${r.duration},"${r.menus.join('/')}",${r.price || 0},${c ? c.name : ''},${c ? c.phone : ''}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `barber_backup_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
