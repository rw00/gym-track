const MIN_ATTENDANCE_MINUTES = 30;
const SAFE_ATTENDANCE_OFFSET = 1;
const SAFE_MIN_ATTENDANCE_MINUTES =
    MIN_ATTENDANCE_MINUTES + SAFE_ATTENDANCE_OFFSET;
const DEFAULT_CYCLE_LIMIT = 3;
const WEEKS_PER_CYCLE = 4;
const DAYS_PER_WEEK = 7;
const CYCLE_LENGTH_DAYS = WEEKS_PER_CYCLE * DAYS_PER_WEEK;
const DEFAULT_CYCLE_COST = 60.8;
const DEFAULT_DISCOUNT_PER_VISIT = 1.0;
const CURRENCY_DECIMAL_PLACES = 2;
const JS_MONTH_OFFSET = 1;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const TOAST_DURATION_MS = 3000;
const TIMER_TICK_INTERVAL_MS = 1000;
const HTTP_STATUS = {
    OK: 200,
    UNAUTHORIZED: 401
};

window.APP_CONSTANTS = {
    MIN_ATTENDANCE_MINUTES,
    SAFE_ATTENDANCE_OFFSET,
    SAFE_MIN_ATTENDANCE_MINUTES,
    DEFAULT_CYCLE_LIMIT,
    WEEKS_PER_CYCLE,
    DAYS_PER_WEEK,
    CYCLE_LENGTH_DAYS,
    DEFAULT_CYCLE_COST,
    DEFAULT_DISCOUNT_PER_VISIT,
    CURRENCY_DECIMAL_PLACES
};

const state = {
    view: 'login',
    status: null,
    history: [],
    pdfReport: null,
    allExpanded: false
};

const views = {
    report: document.getElementById('report-view'),
    login: document.getElementById('login-view'),
    dashboard: document.getElementById('dashboard-view'),
    history: document.getElementById('history-view')
};

const appNav = document.getElementById('app-nav');
const navReportBtn = document.getElementById('nav-report-btn');
const navHistoryBtn = document.getElementById('nav-history-btn');
const navLiveBtn = document.getElementById('nav-live-btn');
const navLogoutBtn = document.getElementById('nav-logout-btn');

const hamburgerBtn = document.getElementById('nav-hamburger-btn');
const mobileNavMenu = document.getElementById('mobile-nav-menu');
const mobileNavReportBtn = document.getElementById('mobile-nav-report-btn');
const mobileNavHistoryBtn = document.getElementById('mobile-nav-history-btn');
const mobileNavLiveBtn = document.getElementById('mobile-nav-live-btn');
const mobileNavLogoutBtn = document.getElementById('mobile-nav-logout-btn');

const pdfDropzone = document.getElementById('pdf-dropzone');
const pdfFileInput = document.getElementById('pdf-file-input');
const uploadStatus = document.getElementById('upload-status');
const uploadStatusText = document.getElementById('upload-status-text');
const uploadError = document.getElementById('upload-error');
const reportContainer = document.getElementById('report-container');
const toggleAllBtn = document.getElementById('toggle-all-details-btn');
const cyclesSectionTitle = document.getElementById('cycles-section-title');

const loginForm = document.getElementById('login-form');
const statusCard = document.getElementById('status-card');
const checkinBtn = document.getElementById('checkin-btn');
const checkoutBtn = document.getElementById('checkout-btn');
const directCheckoutBtn = document.getElementById('direct-checkout-btn');
const doneMsg = document.getElementById('done-msg');
const historyList = document.getElementById('history-list');

const appModal = {
    overlay: document.getElementById('modal-overlay'),
    title: document.getElementById('modal-title'),
    message: document.getElementById('modal-message'),
    cancel: document.getElementById('modal-cancel'),
    confirm: document.getElementById('modal-confirm'),
    callback: null,

    show(title, message, callback) {
        try {
            this.title.innerText = title;
            this.message.innerHTML = message;
            this.callback = callback;
            if (this.overlay) {
                this.overlay.classList.remove('hidden');
                this.overlay.style.display = 'flex';
            }
        } catch (err) {
            console.error('Error in appModal.show:', err);
        }
    },
    hide() {
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            this.overlay.style.display = 'none';
        }
        this.callback = null;
    }
};

if (appModal.cancel) appModal.cancel.onclick = () => appModal.hide();
if (appModal.confirm)
    appModal.confirm.onclick = () => {
        if (appModal.callback) appModal.callback();
        appModal.hide();
    };

function showToast(msg) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = msg;
        toast.classList.remove('hidden');
        toast.style.display = 'block';
        setTimeout(() => {
            toast.classList.add('hidden');
            toast.style.display = 'none';
        }, TOAST_DURATION_MS);
    }
}

function toggleMobileNav() {
    if (!mobileNavMenu || !hamburgerBtn) return;
    const isOpen = hamburgerBtn.classList.toggle('is-open');
    mobileNavMenu.classList.toggle('hidden', !isOpen);
    hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeMobileNav() {
    if (!mobileNavMenu || !hamburgerBtn) return;
    hamburgerBtn.classList.remove('is-open');
    mobileNavMenu.classList.add('hidden');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
}

if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMobileNav();
    });
}

document.addEventListener('click', (e) => {
    if (
        mobileNavMenu &&
        !mobileNavMenu.classList.contains('hidden') &&
        !mobileNavMenu.contains(e.target) &&
        !hamburgerBtn?.contains(e.target)
    ) {
        closeMobileNav();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeMobileNav();
    }
});

function switchView(viewName, pushHistory = true) {
    Object.keys(views).forEach((v) => {
        if (views[v]) views[v].classList.add('hidden');
    });

    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        state.view = viewName;

        if (pushHistory) {
            const newHash = `#${viewName}`;
            if (window.location.hash !== newHash) {
                window.history.pushState({ view: viewName }, '', newHash);
            }
        }

        closeMobileNav();

        if (viewName === 'login') {
            if (appNav) appNav.classList.add('hidden');
            const loginError = document.getElementById('login-error');
            if (loginError) {
                loginError.innerText = '';
                loginError.classList.add('hidden');
            }
        } else {
            if (appNav) appNav.classList.remove('hidden');

            const isReport = viewName === 'report';
            const isHistory = viewName === 'history';
            const isLive = viewName === 'dashboard';

            if (navReportBtn) navReportBtn.classList.toggle('active', isReport);
            if (navHistoryBtn)
                navHistoryBtn.classList.toggle('active', isHistory);
            if (navLiveBtn) navLiveBtn.classList.toggle('active', isLive);

            if (mobileNavReportBtn)
                mobileNavReportBtn.classList.toggle('active', isReport);
            if (mobileNavHistoryBtn)
                mobileNavHistoryBtn.classList.toggle('active', isHistory);
            if (mobileNavLiveBtn)
                mobileNavLiveBtn.classList.toggle('active', isLive);
        }

        if (viewName === 'dashboard') loadStatus();
        if (viewName === 'history') loadHistory();
    }
}

window.addEventListener('popstate', (e) => {
    const view =
        e.state?.view || window.location.hash.replace('#', '') || 'login';
    if (views[view]) {
        switchView(view, false);
    }
});

async function api(path, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const result = await fetch(path, options);
        if (result.status === HTTP_STATUS.UNAUTHORIZED) {
            if (state.view !== 'login') {
                switchView('login');
            }
            return null;
        }
        return await result.json();
    } catch (err) {
        return null;
    }
}

function setupPdfHandlers() {
    if (!pdfDropzone || !pdfFileInput) return;

    ['dragenter', 'dragover'].forEach((eventName) => {
        pdfDropzone.addEventListener(
            eventName,
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                pdfDropzone.classList.add('drag-over');
            },
            false
        );
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        pdfDropzone.addEventListener(
            eventName,
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                pdfDropzone.classList.remove('drag-over');
            },
            false
        );
    });

    pdfDropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handlePdfFile(files[0]);
        }
    });

    pdfFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handlePdfFile(e.target.files[0]);
        }
    });

    if (toggleAllBtn) {
        toggleAllBtn.addEventListener('click', toggleAllDetails);
    }

    const newUploadBtn = document.getElementById('new-upload-btn');
    if (newUploadBtn) {
        newUploadBtn.addEventListener('click', () => {
            const dropzoneCard = document.getElementById('dropzone-card');
            const pdfHero = document.getElementById('pdf-hero');
            if (dropzoneCard) dropzoneCard.classList.remove('hidden');
            if (pdfHero) pdfHero.classList.remove('hidden');
            if (dropzoneCard)
                dropzoneCard.scrollIntoView({ behavior: 'smooth' });
        });
    }
}

async function handlePdfFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        showUploadError('Please upload a valid PDF file.');
        return;
    }

    showUploadProgress('Reading and analyzing PDF check-in records...');

    try {
        const formData = new FormData();
        formData.append('pdf', file);

        const res = await fetch('/api/parse-pdf?all=true', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to parse PDF file');
        }

        const data = await res.json();
        state.pdfReport = data;
        renderCurrentFilter();
        showToast('PDF parsed successfully!');
        if (state.view !== 'login') {
            loadStatus();
        }
    } catch (err) {
        showUploadError(err.message || 'Error processing PDF');
    } finally {
        hideUploadProgress();
    }
}

function showUploadProgress(msg) {
    if (uploadStatus) {
        uploadStatus.classList.remove('hidden');
        if (uploadStatusText) uploadStatusText.innerText = msg;
    }
    if (uploadError) uploadError.classList.add('hidden');
}

function hideUploadProgress() {
    if (uploadStatus) uploadStatus.classList.add('hidden');
}

function showUploadError(msg) {
    if (uploadError) {
        uploadError.innerText = msg;
        uploadError.classList.remove('hidden');
    }
}

function renderCurrentFilter() {
    if (!state.pdfReport) return;

    const data = state.pdfReport;
    const allCycles = data.cycles || data.allCycles || [];
    const displayedCycles = allCycles.slice(0, DEFAULT_CYCLE_LIMIT);

    state.allExpanded = false;
    if (toggleAllBtn) toggleAllBtn.innerText = 'Expand All Details';

    const dropzoneCard = document.getElementById('dropzone-card');
    const pdfHero = document.getElementById('pdf-hero');
    if (dropzoneCard) dropzoneCard.classList.add('hidden');
    if (pdfHero) pdfHero.classList.add('hidden');

    if (cyclesSectionTitle) {
        cyclesSectionTitle.innerText = `Last ${DEFAULT_CYCLE_LIMIT} Cycles`;
    }

    const cyclesList = document.getElementById('cycles-list');
    cyclesList.innerHTML = displayedCycles
        .map((cycle, idx) => {
            const hasEarly = cycle.tooEarlyCount > 0;
            return `
            <div class="cycle-card ${hasEarly ? 'has-too-early' : ''}" id="cycle-card-${idx}">
                <div class="cycle-card-header">
                    <div class="cycle-date-range">
                        From ${formatDateShort(cycle.startDate)} to ${formatDateShort(cycle.endDate)}
                    </div>
                </div>

                ${
                    hasEarly
                        ? `
                    <div class="too-early-alert">
                        <span class="too-early-icon">⚠️</span>
                        <span>${cycle.tooEarlyCount} time${cycle.tooEarlyCount > 1 ? 's' : ''} were not counted because you left too early !!!</span>
                    </div>
                `
                        : ''
                }

                <div class="cycle-financials">
                    <div class="fin-item">
                        <span class="fin-label">Base Membership</span>
                        <span class="fin-val">€${cycle.baseCost.toFixed(CURRENCY_DECIMAL_PLACES)}</span>
                    </div>
                    <div class="fin-item">
                        <span class="fin-label">Workout Discount</span>
                        <span class="fin-val discount">-€${cycle.discount.toFixed(CURRENCY_DECIMAL_PLACES)}</span>
                    </div>
                    <div class="fin-item">
                        <span class="fin-label">Expected Payment</span>
                        <span class="fin-val payment">€${cycle.expectedPayment.toFixed(CURRENCY_DECIMAL_PLACES)}</span>
                    </div>
                </div>

                <button class="cycle-details-toggle" data-idx="${idx}">
                    <span>View ${cycle.records.length} Workout Days</span>
                    <span class="toggle-arrow">▼</span>
                </button>

                <div class="sessions-accordion hidden" id="sessions-${idx}">
                    ${cycle.records
                        .map((day) => {
                            const isCounted =
                                day.durationMinutes >=
                                SAFE_MIN_ATTENDANCE_MINUTES;
                            const isThirty =
                                day.durationMinutes === MIN_ATTENDANCE_MINUTES;

                            const rowClass = isCounted
                                ? ''
                                : isThirty
                                  ? 'is-orange'
                                  : 'is-invalid';
                            const tagClass = isCounted
                                ? 'tag-counted'
                                : isThirty
                                  ? 'tag-orange'
                                  : 'tag-too-early';
                            const tagText = isCounted
                                ? `✓ ${day.durationMinutes} min`
                                : isThirty
                                  ? `${MIN_ATTENDANCE_MINUTES} min`
                                  : `✕ ${day.durationMinutes} min (Left too early)`;

                            return `
                            <div class="session-row ${rowClass}">
                                <div class="session-left">
                                    <span class="session-date-time">
                                        ${formatDateWithWeekday(day.isoDate)} · ${day.timeStr}
                                    </span>
                                </div>
                                <div>
                                    <span class="session-status-tag ${tagClass}">
                                        ${tagText}
                                    </span>
                                </div>
                            </div>
                        `;
                        })
                        .join('')}
                </div>
            </div>
        `;
        })
        .join('');

    document.querySelectorAll('.cycle-details-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = btn.dataset.idx;
            const accordion = document.getElementById(`sessions-${idx}`);
            const arrow = btn.querySelector('.toggle-arrow');
            if (accordion) {
                accordion.classList.toggle('hidden');
                if (arrow) {
                    arrow.innerText = accordion.classList.contains('hidden')
                        ? '▼'
                        : '▲';
                }
            }
        });
    });

    if (reportContainer) {
        reportContainer.classList.remove('hidden');
    }
}

function toggleAllDetails() {
    state.allExpanded = !state.allExpanded;
    if (toggleAllBtn) {
        toggleAllBtn.innerText = state.allExpanded
            ? 'Collapse All Details'
            : 'Expand All Details';
    }
    document.querySelectorAll('.sessions-accordion').forEach((acc) => {
        if (state.allExpanded) {
            acc.classList.remove('hidden');
        } else {
            acc.classList.add('hidden');
        }
    });
    document.querySelectorAll('.toggle-arrow').forEach((arrow) => {
        arrow.innerText = state.allExpanded ? '▲' : '▼';
    });
}

function formatDateShort(isoDateStr) {
    if (!isoDateStr) return '';
    const [y, m, d] = isoDateStr.split('-').map(Number);
    const date = new Date(y, m - JS_MONTH_OFFSET, d);
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function formatDateWithWeekday(isoDateStr) {
    if (!isoDateStr) return '';
    const [y, m, d] = isoDateStr.split('-').map(Number);
    const date = new Date(y, m - JS_MONTH_OFFSET, d);
    return date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });
}

async function loadStatus() {
    if (statusCard) statusCard.innerHTML = loaderView();
    const data = await api('/api/status');
    if (!data) return;

    state.status = data;
    renderStatus();
}

function renderStatus() {
    const { activeSession, attendedToday } = state.status;

    if (checkinBtn) checkinBtn.classList.add('hidden');
    if (checkoutBtn) checkoutBtn.classList.add('hidden');
    if (directCheckoutBtn) directCheckoutBtn.classList.add('hidden');
    if (doneMsg) doneMsg.classList.add('hidden');

    if (attendedToday) {
        if (statusCard) statusCard.classList.add('hidden');
        if (doneMsg) doneMsg.classList.remove('hidden');
    } else if (activeSession) {
        if (statusCard) {
            statusCard.classList.remove('hidden');
            const startTime = new Date(activeSession.startTime);
            statusCard.innerHTML = `
                <p>Active Session</p>
                <div class="status-time" id="timer">00:00:00</div>
                <p>Started at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            `;
        }
        if (checkoutBtn) checkoutBtn.classList.remove('hidden');
        startTimer(activeSession.startTime);
    } else {
        if (statusCard) {
            statusCard.classList.remove('hidden');
            statusCard.innerHTML =
                '<h2>Ready for training?</h2><p>No active session</p>';
        }
        if (checkinBtn) checkinBtn.classList.remove('hidden');
        if (directCheckoutBtn) directCheckoutBtn.classList.remove('hidden');
    }
}

let timerInterval;
function startTimer(strStartTime) {
    if (timerInterval) clearInterval(timerInterval);
    const start = new Date(strStartTime).getTime();

    const update = () => {
        const now = Date.now();
        const diff = Math.max(0, now - start);
        const h = Math.floor(diff / MS_PER_HOUR);
        const m = Math.floor((diff % MS_PER_HOUR) / MS_PER_MINUTE);
        const s = Math.floor((diff % MS_PER_MINUTE) / MS_PER_SECOND);

        const timer = document.getElementById('timer');
        if (timer) {
            timer.innerText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            const minAttendance =
                state.status?.minAttendanceMinutes || MIN_ATTENDANCE_MINUTES;
            if (h > 0 || m >= minAttendance + SAFE_ATTENDANCE_OFFSET) {
                timer.classList.add('timer-passed');
            } else {
                timer.classList.remove('timer-passed');
            }
        }
    };

    update();
    timerInterval = setInterval(update, TIMER_TICK_INTERVAL_MS);
}

async function loadHistory() {
    if (historyList) historyList.innerHTML = loaderView();
    const data = await api('/api/history');
    if (!data) return;

    state.history = data;
    renderHistory();
}

function loaderView() {
    return `<div class="loader"></div>`;
}

function renderHistory() {
    if (!historyList) return;
    if (state.history.length === 0) {
        historyList.innerHTML =
            '<p class="text-center" style="padding: 40px; color: var(--text-muted);">No history yet</p>';
        return;
    }

    historyList.innerHTML = state.history
        .map(
            (month) => `
        <div class="month-group">
            <div class="month-header">
                <span class="month-name">${formatMonth(month.month)}</span>
                <span class="payment-tag">Pay: €${month.expectedPayment}</span>
            </div>
            ${month.records
                .map(
                    (record) => `
                <div class="record-item">
                    <div class="record-info">
                        <div class="record-date">${formatDate(record.date)}</div>
                        <div class="record-duration">${record.method === 'direct-checkout' ? 'Direct' : record.durationMinutes + ' mins'}</div>
                    </div>
                    <div class="record-checkout-time">${formatTime(record.endTime)}</div>
                </div>
            `
                )
                .join('')}
        </div>
    `
        )
        .join('');
}

function formatMonth(monthKey) {
    if (monthKey.includes(' to ')) {
        const [startStr, endStr] = monthKey.split(' to ');
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        const startFormatted = startDate.toLocaleDateString('default', {
            month: 'short',
            day: 'numeric'
        });
        const endFormatted = endDate.toLocaleDateString('default', {
            month: 'short',
            day: 'numeric'
        });
        return `${startFormatted} - ${endFormatted}`;
    }
    const [y, m] = monthKey.split('-');
    const date = new Date(y, m - JS_MONTH_OFFSET);
    return date.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('default', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

if (navReportBtn) {
    navReportBtn.onclick = () => switchView('report');
}

if (navHistoryBtn) {
    navHistoryBtn.onclick = () => switchView('history');
}

if (navLiveBtn) {
    navLiveBtn.onclick = () => switchView('dashboard');
}

if (navLogoutBtn) {
    navLogoutBtn.onclick = async () => {
        await api('/logout', 'POST');
        switchView('login');
    };
}

if (mobileNavReportBtn) {
    mobileNavReportBtn.onclick = () => switchView('report');
}

if (mobileNavHistoryBtn) {
    mobileNavHistoryBtn.onclick = () => switchView('history');
}

if (mobileNavLiveBtn) {
    mobileNavLiveBtn.onclick = () => switchView('dashboard');
}

if (mobileNavLogoutBtn) {
    mobileNavLogoutBtn.onclick = async () => {
        await api('/logout', 'POST');
        switchView('login');
    };
}

if (loginForm) {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const loginError = document.getElementById('login-error');

        if (loginError) {
            loginError.innerText = '';
            loginError.classList.add('hidden');
        }
        const responseBody = await api('/login', 'POST', {
            username,
            password
        });

        if (responseBody?.success) {
            switchView('report');
        } else if (loginError) {
            loginError.innerText = 'Invalid username or password';
            loginError.classList.remove('hidden');
        }
    };
}

if (checkinBtn) {
    checkinBtn.onclick = async () => {
        const responseBody = await api('/api/checkin', 'POST');
        if (responseBody?.success) {
            showToast('Checked in!');
            loadStatus();
        }
    };
}

if (checkoutBtn) {
    checkoutBtn.onclick = () => {
        const activeSession = state.status?.activeSession;
        let isFullSession = true;
        if (activeSession) {
            const start = new Date(activeSession.startTime).getTime();
            const now = Date.now();
            const diffMinutes = Math.floor((now - start) / MS_PER_MINUTE);
            const minAttendance =
                state.status?.minAttendanceMinutes || MIN_ATTENDANCE_MINUTES;
            if (diffMinutes < minAttendance + SAFE_ATTENDANCE_OFFSET) {
                isFullSession = false;
            }
        }

        const message = isFullSession
            ? 'Are you sure you want to check out?'
            : 'Are you sure you want to check out?<div class="modal-warning">Warning: This session is under the minimum duration and will be discarded.</div>';

        appModal.show('Finish Session', message, async () => {
            const responseBody = await api('/api/checkout', 'POST');
            if (responseBody?.success) {
                showToast(responseBody.message);
                loadStatus();
            }
        });
    };
}

if (directCheckoutBtn) {
    directCheckoutBtn.onclick = () => {
        appModal.show(
            'Direct Check Out',
            'Record attendance for today without timer?',
            async () => {
                const responseBody = await api('/api/checkout', 'POST');
                if (responseBody?.success) {
                    showToast('Attendance recorded');
                    loadStatus();
                }
            }
        );
    };
}

(async () => {
    setupPdfHandlers();

    const data = await api('/api/status');
    if (data) {
        state.status = data;
        const hashView = window.location.hash.replace('#', '');
        if (hashView && views[hashView] && hashView !== 'login') {
            switchView(hashView, false);
        } else {
            switchView('report', false);
        }
    } else {
        switchView('login', false);
    }
})();
