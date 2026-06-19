const DB_NAME = 'BarberAppDB';
const DB_VERSION = 1;

let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('customers')) {
                db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('reservations')) {
                db.createObjectStore('reservations', { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => {
            reject('DB error: ' + event.target.errorCode);
        };
    });
}

async function getAllCustomers() {
    return new Promise((resolve) => {
        const transaction = db.transaction(['customers'], 'readonly');
        const store = transaction.objectStore('customers');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function addCustomer(customer) {
    return new Promise((resolve) => {
        const transaction = db.transaction(['customers'], 'readwrite');
        const store = transaction.objectStore('customers');
        const request = store.add(customer);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllReservations() {
    return new Promise((resolve) => {
        const transaction = db.transaction(['reservations'], 'readonly');
        const store = transaction.objectStore('reservations');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function addReservation(reservation) {
    return new Promise((resolve) => {
        const transaction = db.transaction(['reservations'], 'readwrite');
        const store = transaction.objectStore('reservations');
        const request = store.add(reservation);
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteReservation(id) {
    return new Promise((resolve) => {
        const transaction = db.transaction(['reservations'], 'readwrite');
        const store = transaction.objectStore('reservations');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
    });
}

async function updateReservation(reservation) {
    return new Promise((resolve) => {
        const transaction = db.transaction(['reservations'], 'readwrite');
        const store = transaction.objectStore('reservations');
        const request = store.put(reservation);
        request.onsuccess = () => resolve(request.result);
    });
}
