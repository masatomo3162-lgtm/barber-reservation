const DB_NAME = 'BarberAppDB';
const DB_VERSION = 2;

let db;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const openedDB = event.target.result;
            if (!openedDB.objectStoreNames.contains('customers')) {
                openedDB.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
            }
            if (!openedDB.objectStoreNames.contains('reservations')) {
                openedDB.createObjectStore('reservations', { keyPath: 'id', autoIncrement: true });
            }
            // v2: 施術メニューを永続化するストア（既存データには影響しない）
            if (!openedDB.objectStoreNames.contains('menus')) {
                openedDB.createObjectStore('menus', { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };

        request.onerror = () => reject(request.error || new Error('データベースを開けませんでした'));
        request.onblocked = () => reject(new Error('データベース更新がほかの画面によりブロックされています'));
    });
}

function getStore(storeName, mode = 'readonly') {
    if (!db) throw new Error('データベースが初期化されていません');
    return db.transaction([storeName], mode).objectStore(storeName);
}

async function getAllCustomers() {
    return requestToPromise(getStore('customers').getAll());
}

async function addCustomer(customer) {
    return requestToPromise(getStore('customers', 'readwrite').add(customer));
}

async function updateCustomer(customer) {
    return requestToPromise(getStore('customers', 'readwrite').put(customer));
}

async function deleteCustomer(id) {
    return requestToPromise(getStore('customers', 'readwrite').delete(id));
}

async function clearCustomers() {
    const transaction = db.transaction(['customers'], 'readwrite');
    transaction.objectStore('customers').clear();
    return transactionToPromise(transaction);
}

async function getAllReservations() {
    return requestToPromise(getStore('reservations').getAll());
}

async function addReservation(reservation) {
    return requestToPromise(getStore('reservations', 'readwrite').add(reservation));
}

async function deleteReservation(id) {
    return requestToPromise(getStore('reservations', 'readwrite').delete(id));
}

async function updateReservation(reservation) {
    return requestToPromise(getStore('reservations', 'readwrite').put(reservation));
}

async function clearReservations() {
    const transaction = db.transaction(['reservations'], 'readwrite');
    transaction.objectStore('reservations').clear();
    return transactionToPromise(transaction);
}

// ===== 施術メニュー（v2追加）=====
async function getAllMenus() {
    return requestToPromise(getStore('menus').getAll());
}

async function addMenu(menu) {
    return requestToPromise(getStore('menus', 'readwrite').add(menu));
}

async function updateMenu(menu) {
    return requestToPromise(getStore('menus', 'readwrite').put(menu));
}

async function deleteMenu(id) {
    return requestToPromise(getStore('menus', 'readwrite').delete(id));
}


async function clearMenus() {
    const transaction = db.transaction(['menus'], 'readwrite');
    transaction.objectStore('menus').clear();
    return transactionToPromise(transaction);
}
