let calendar;
let selectedDate = new Date().toISOString().split('T')[0];

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
            right: 'dayGridMonth,timeGridWeek'
        },
        dateClick: function(info) {
            openDayView(info.dateStr);
        },
        events: async function(fetchInfo, successCallback, failureCallback) {
            const reservations = await getAllReservations();
            const events = reservations.map(r => ({
                id: r.id,
                title: r.menus.join(', '),
                start: `${r.date}T${r.startTime}`,
                end: calculateEndTimeISO(r.date, r.startTime, r.duration),
                backgroundColor: r.color || '#e67e22',
                textColor: '#333' // パステルカラーで見やすくするため黒系文字に
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
        block.style.color = '#333'; // パステルカラー用
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
    
    const total = Array.from(document.querySelectorAll('input[name="menu"]:checked'))
        .reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
    document.getElementById('res-total-time').textContent = total;

    document.getElementById('reservation-modal').style.display = 'block';
}

async function handleReservationDeleteFromModal() {
    const id = parseInt(document.getElementById('res-id').value);
    if (id && confirm('この予約を取り消しますか？')) {
        await deleteReservation(id);
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
        const customer = {
            name: document.getElementById('cust-name').value,
            phone: document.getElementById('cust-phone').value,
            note: document.getElementById('cust-note').value,
            createdAt: new Date().toISOString()
        };
        await addCustomer(customer);
        closeModal('customer-modal');
        renderCustomers();
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
            reservationData.color = existing.color; // 既存の色を維持
            await updateReservation(reservationData);
        } else {
            reservationData.color = getRandomPastelColor(); // 新規はランダム
            await addReservation(reservationData);
        }
        
        closeModal('reservation-modal');
        renderTimeline(selectedDate);
        renderCustomers();
        e.target.reset();
        document.getElementById('res-id').value = '';
    });

    document.querySelectorAll('input[name="menu"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
            const total = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
            document.getElementById('res-total-time').textContent = total;
        });
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

        const memoHtml = c.note ? `<ul class="memo-list">${c.note.split('\n').map(line => `<li>${line}</li>`).join('')}</ul>` : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${c.name}</strong>${memoHtml}</td>
            <td>${c.phone}</td>
            <td>${lastVisit}${daysAgoText}</td>
            <td>
                <button onclick="deleteCustomer(${c.id})" style="background:#e74c3c">削除</button>
            </td>
        `;
        list.appendChild(tr);
        
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
    });
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
    document.getElementById('customer-modal').style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function deleteCustomer(id) {
    if (confirm('顧客情報を削除しますか？（予約履歴は残ります）')) {
        const transaction = db.transaction(['customers'], 'readwrite');
        const store = transaction.objectStore('customers');
        await store.delete(id);
        renderCustomers();
    }
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
