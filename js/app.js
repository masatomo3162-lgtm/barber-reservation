document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    setCurrentDate();
    renderCustomers();
    renderReservations();
    setupEventListeners();
});

function setCurrentDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('calendar-date').value = today;
}

function showSection(sectionId) {
    document.querySelectorAll('main section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
}

function setupEventListeners() {
    document.getElementById('calendar-date').addEventListener('change', renderReservations);
    
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
        const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
        const menus = Array.from(checkboxes).map(cb => cb.parentNode.textContent.trim());
        const totalMinutes = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
        
        const startTime = document.getElementById('res-start-time').value;
        const date = document.getElementById('calendar-date').value;
        
        const reservation = {
            customerId: parseInt(document.getElementById('res-customer-id').value),
            date: date,
            startTime: startTime,
            duration: totalMinutes,
            menus: menus,
            interval: 5
        };
        
        await addReservation(reservation);
        closeModal('reservation-modal');
        renderReservations();
        e.target.reset();
    });

    // 合計時間のリアルタイム更新
    document.querySelectorAll('input[name="menu"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
            const total = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
            document.getElementById('res-total-time').textContent = total;
        });
    });
}

async function renderCustomers() {
    const customers = await getAllCustomers();
    const list = document.getElementById('customer-list');
    const select = document.getElementById('res-customer-id');
    
    list.innerHTML = '';
    select.innerHTML = '<option value="">顧客を選択してください</option>';
    
    customers.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.name}</td>
            <td>${c.phone}</td>
            <td>-</td>
            <td><button onclick="deleteCustomer(${c.id})">削除</button></td>
        `;
        list.appendChild(tr);
        
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        select.appendChild(opt);
    });
}

async function renderReservations() {
    const date = document.getElementById('calendar-date').value;
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    const list = document.getElementById('reservation-list');
    
    list.innerHTML = '';
    
    const filtered = reservations
        .filter(r => r.date === date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    if (filtered.length === 0) {
        list.innerHTML = '<p>この日の予約はありません。</p>';
        return;
    }

    filtered.forEach(r => {
        const customer = customers.find(c => c.id === r.customerId);
        const endTime = calculateEndTime(r.startTime, r.duration);
        const div = document.createElement('div');
        div.className = 'reservation-item';
        div.innerHTML = `
            <div>
                <span class="reservation-time">${r.startTime} - ${endTime}</span>
                <div style="font-weight:bold">${customer ? customer.name : '不明な顧客'}</div>
                <div style="font-size:0.8em; color:#666">${r.menus.join(', ')}</div>
            </div>
            <button onclick="handleDeleteReservation(${r.id})" style="background:#e74c3c">取消</button>
        `;
        list.appendChild(div);
    });
}

function calculateEndTime(start, duration) {
    const [hours, minutes] = start.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + duration);
    return date.getHours().toString().padStart(2, '0') + ':' + 
           date.getMinutes().toString().padStart(2, '0');
}

async function handleDeleteReservation(id) {
    if (confirm('この予約を取消しますか？')) {
        await deleteReservation(id);
        renderReservations();
    }
}

function openReservationModal() {
    document.getElementById('reservation-modal').style.display = 'block';
}

function openCustomerModal() {
    document.getElementById('customer-modal').style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function exportToCSV() {
    const reservations = await getAllReservations();
    const customers = await getAllCustomers();
    
    let csv = 'ID,日付,開始時間,所要時間,メニュー,顧客名,電話番号\n';
    
    reservations.forEach(r => {
        const c = customers.find(cust => cust.id === r.customerId);
        csv += `${r.id},${r.date},${r.startTime},${r.duration},"${r.menus.join('/')}",${c ? c.name : ''},${c ? c.phone : ''}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `barber_backup_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
