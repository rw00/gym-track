/**
 * AttendanceCalendar: month calendar for marking training days.
 *
 * Modes:
 * - "select":  tap toggles a day, drag paints a range, Shift+click selects a
 *              span, weekday headers toggle a whole column. Keyboard: arrows
 *              move, Shift+arrows extend, Space/Enter toggle, PageUp/PageDown
 *              change month, Ctrl/Cmd+Z undo.
 * - "compare": days are coloured by verification status; tapping a day opens
 *              a details popover with a mark/unmark action.
 *
 * Marked days persist in localStorage.
 */
import { STATUS, addDaysIso, isIsoDate } from './attendanceCompare.js';

export const MARKED_DAYS_STORAGE_KEY = 'gymtrack.markedDays.v1';

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const LAST_COLUMN = DAYS_PER_WEEK - 1;
const MAX_UNDO_STEPS = 50;
const REVEAL_DURATION_MS = 1400;
const POPOVER_GAP_PX = 8;
const ISO_PAD_LENGTH = 2;

const WEEKDAYS = [
    ['Mon', 'Monday'],
    ['Tue', 'Tuesday'],
    ['Wed', 'Wednesday'],
    ['Thu', 'Thursday'],
    ['Fri', 'Friday'],
    ['Sat', 'Saturday'],
    ['Sun', 'Sunday']
];

export const STATUS_META = Object.freeze({
    [STATUS.VERIFIED]: { label: 'Verified', icon: '✓' },
    [STATUS.NOT_COUNTED]: { label: 'Not counted', icon: '−' },
    [STATUS.MISSING]: { label: 'Missing', icon: '!' },
    [STATUS.UNMARKED]: { label: 'Unmarked', icon: '?' },
    [STATUS.PENDING]: { label: 'Pending', icon: '…' }
});

const CHEVRON_LEFT =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHEVRON_RIGHT =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

const TEMPLATE = `
    <div class="cal-header">
        <div class="cal-navs">
            <button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month">${CHEVRON_LEFT}</button>
            <button type="button" class="cal-nav" data-nav="1" aria-label="Next month">${CHEVRON_RIGHT}</button>
        </div>
        <h3 class="cal-title" aria-live="polite"></h3>
        <span class="cal-count" aria-live="polite"></span>
    </div>
    <div class="cal-weekdays">
        ${WEEKDAYS.map(
            ([short, long], i) =>
                `<button type="button" class="cal-weekday" data-dow="${i}" title="Toggle every ${long} this month" aria-label="Toggle every ${long} this month">${short}</button>`
        ).join('')}
    </div>
    <div class="cal-grid" role="group"></div>
    <div class="cal-footer">
        <div class="cal-actions">
            <button type="button" class="cal-action" data-action="clear-month">Clear month</button>
            <button type="button" class="cal-action" data-action="undo">Undo</button>
        </div>
        <p class="cal-hint"></p>
    </div>
    <div class="cal-popover hidden" role="dialog" aria-label="Day details"></div>
`;

function pad(n) {
    return String(n).padStart(ISO_PAD_LENGTH, '0');
}

function toIso(y, m0, d) {
    return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

function parseIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m0: m - 1, d };
}

function monthKey(y, m0) {
    return y * MONTHS_PER_YEAR + m0;
}

function fromMonthKey(key) {
    return {
        y: Math.floor(key / MONTHS_PER_YEAR),
        m0: ((key % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR
    };
}

function daysInMonth(y, m0) {
    return new Date(y, m0 + 1, 0).getDate();
}

/** 0 = Monday … 6 = Sunday */
function weekdayIndex(y, m0, d) {
    return (new Date(y, m0, d).getDay() + LAST_COLUMN) % DAYS_PER_WEEK;
}

function formatLongDate(iso) {
    const { y, m0, d } = parseIso(iso);
    return new Date(y, m0, d).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function formatPopoverDate(iso) {
    const { y, m0, d } = parseIso(iso);
    return new Date(y, m0, d).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });
}

function safeStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export function loadMarkedDays(storage = safeStorage()) {
    try {
        const raw = storage?.getItem(MARKED_DAYS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter(isIsoDate) : []);
    } catch {
        return new Set();
    }
}

export function saveMarkedDays(selected, storage = safeStorage()) {
    try {
        storage?.setItem(
            MARKED_DAYS_STORAGE_KEY,
            JSON.stringify([...selected].sort())
        );
    } catch {
        // Storage may be full or disabled; selection still works in-memory.
    }
}

function popoverMessage(status, record) {
    switch (status) {
        case STATUS.VERIFIED:
            return 'You marked this day and the gym counted it.';
        case STATUS.NOT_COUNTED:
            return record?.isThirtyMin
                ? `The gym recorded exactly ${record.durationMinutes} min, which is right at the limit, so the visit wasn't counted.`
                : `The gym recorded a ${record?.durationMinutes ?? 0}-min visit. That's too short to earn a discount.`;
        case STATUS.MISSING:
            return 'You marked this day, but the PDF has no check-in. If you trained, the gym missed this visit.';
        case STATUS.UNMARKED:
            return "The gym recorded a visit you didn't mark. Did you forget to mark it?";
        case STATUS.PENDING:
            return "Today's visit may not be in the PDF yet. Upload a newer export later.";
        default:
            return 'No visit marked or recorded on this day.';
    }
}

export class AttendanceCalendar {
    constructor({ onChange = () => {} } = {}) {
        this.onChange = onChange;
        this.selected = loadMarkedDays();
        this.lastRenderedSelected = new Set(this.selected);
        this.window = null;
        this.mode = 'select';
        this.statuses = null;
        this.filter = null;
        this.view = null;
        this.focusIso = null;
        this.anchorIso = null;
        this.undoStack = [];
        this.drag = null;
        this.popoverIso = null;
        this.revealTimer = null;
        this.isCoarsePointer =
            typeof window !== 'undefined' &&
            window.matchMedia?.('(pointer: coarse)').matches;

        this.el = document.createElement('div');
        this.el.className = 'cal';
        this.el.dataset.mode = this.mode;
        this.el.innerHTML = TEMPLATE;

        this.refs = {
            title: this.el.querySelector('.cal-title'),
            count: this.el.querySelector('.cal-count'),
            prev: this.el.querySelector('[data-nav="-1"]'),
            next: this.el.querySelector('[data-nav="1"]'),
            weekdays: this.el.querySelector('.cal-weekdays'),
            grid: this.el.querySelector('.cal-grid'),
            clear: this.el.querySelector('[data-action="clear-month"]'),
            undo: this.el.querySelector('[data-action="undo"]'),
            hint: this.el.querySelector('.cal-hint'),
            popover: this.el.querySelector('.cal-popover')
        };

        this.bindEvents();
        this.render();
    }

    /* ---------- Public API ---------- */

    setWindow(verificationWindow) {
        this.window = verificationWindow;
        const end = parseIso(verificationWindow.end);
        if (!this.view || !this.isMonthInWindow(this.view)) {
            this.view = { y: end.y, m0: end.m0 };
        }
        if (!this.focusIso || !this.isEnabled(this.focusIso)) {
            this.focusIso = verificationWindow.end;
        }
        this.render();
    }

    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this.el.dataset.mode = mode;
        this.closePopover();
        if (mode === 'compare') {
            this.reveal();
        } else {
            this.filter = null;
        }
        this.render();
    }

    setStatuses(statuses) {
        this.statuses = statuses;
        if (this.mode === 'compare') this.render();
    }

    setFilter(status) {
        if (this.filter === status) return;
        this.filter = status;
        this.render();
    }

    /** Navigate to the month containing `iso` (if it's in the window). */
    showDate(iso) {
        if (!this.isEnabled(iso)) return;
        const { y, m0 } = parseIso(iso);
        if (this.view?.y === y && this.view?.m0 === m0) return;
        this.view = { y, m0 };
        this.focusIso = iso;
        this.closePopover();
        this.render();
    }

    getSelected() {
        return new Set(this.selected);
    }

    /* ---------- Helpers ---------- */

    isEnabled(iso) {
        return (
            !!this.window && iso >= this.window.start && iso <= this.window.end
        );
    }

    isMonthInWindow({ y, m0 }) {
        if (!this.window) return false;
        const key = monthKey(y, m0);
        const start = parseIso(this.window.start);
        const end = parseIso(this.window.end);
        return (
            key >= monthKey(start.y, start.m0) && key <= monthKey(end.y, end.m0)
        );
    }

    clampIso(iso) {
        if (!this.window) return iso;
        if (iso < this.window.start) return this.window.start;
        if (iso > this.window.end) return this.window.end;
        return iso;
    }

    countInWindow() {
        if (!this.window) return 0;
        let count = 0;
        for (const iso of this.selected) {
            if (this.isEnabled(iso)) count += 1;
        }
        return count;
    }

    visibleMonthIsos() {
        const { y, m0 } = this.view;
        const isos = [];
        for (let d = 1; d <= daysInMonth(y, m0); d++) {
            const iso = toIso(y, m0, d);
            if (this.isEnabled(iso)) isos.push(iso);
        }
        return isos;
    }

    applyRange(target, fromIso, toIsoDate, select) {
        const [start, end] =
            fromIso <= toIsoDate ? [fromIso, toIsoDate] : [toIsoDate, fromIso];
        for (let iso = start; iso <= end; iso = addDaysIso(iso, 1)) {
            if (!this.isEnabled(iso)) continue;
            if (select) target.add(iso);
            else target.delete(iso);
        }
    }

    pushUndo() {
        this.undoStack.push(new Set(this.selected));
        if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
    }

    commit() {
        saveMarkedDays(this.selected);
        this.render();
        this.onChange(this.getSelected());
        if (this.popoverIso) this.openPopover(this.popoverIso);
    }

    reveal() {
        this.el.classList.remove('is-revealing');
        void this.el.offsetWidth;
        this.el.classList.add('is-revealing');
        clearTimeout(this.revealTimer);
        this.revealTimer = setTimeout(
            () => this.el.classList.remove('is-revealing'),
            REVEAL_DURATION_MS
        );
    }

    focusCell() {
        this.refs.grid
            .querySelector(`[data-iso="${this.focusIso}"]`)
            ?.focus({ preventScroll: true });
    }

    moveFocus(iso) {
        this.focusIso = this.clampIso(iso);
        const { y, m0 } = parseIso(this.focusIso);
        if (this.view.y !== y || this.view.m0 !== m0) {
            this.view = { y, m0 };
            this.closePopover();
        }
        this.render();
        this.focusCell();
    }

    /* ---------- Actions ---------- */

    toggleDay(iso) {
        if (!this.isEnabled(iso)) return;
        this.pushUndo();
        if (this.selected.has(iso)) this.selected.delete(iso);
        else this.selected.add(iso);
        this.anchorIso = iso;
        this.focusIso = iso;
        this.commit();
    }

    toggleWeekday(dow) {
        const { y, m0 } = this.view;
        const isos = this.visibleMonthIsos().filter((iso) => {
            const { d } = parseIso(iso);
            return weekdayIndex(y, m0, d) === dow;
        });
        if (isos.length === 0) return;
        const allSelected = isos.every((iso) => this.selected.has(iso));
        this.pushUndo();
        for (const iso of isos) {
            if (allSelected) this.selected.delete(iso);
            else this.selected.add(iso);
        }
        this.commit();
    }

    clearMonth() {
        const isos = this.visibleMonthIsos().filter((iso) =>
            this.selected.has(iso)
        );
        if (isos.length === 0) return;
        this.pushUndo();
        for (const iso of isos) this.selected.delete(iso);
        this.commit();
    }

    undo() {
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.selected = previous;
        this.commit();
    }

    shiftMonth(delta) {
        if (!this.window || !this.view) return;
        const start = parseIso(this.window.start);
        const end = parseIso(this.window.end);
        const key = Math.min(
            Math.max(
                monthKey(this.view.y, this.view.m0) + delta,
                monthKey(start.y, start.m0)
            ),
            monthKey(end.y, end.m0)
        );
        this.view = fromMonthKey(key);
        this.closePopover();
        this.render();
    }

    /* ---------- Events ---------- */

    bindEvents() {
        const { grid, weekdays, prev, next, clear, undo, popover } = this.refs;

        prev.addEventListener('click', () => this.shiftMonth(-1));
        next.addEventListener('click', () => this.shiftMonth(1));
        clear.addEventListener('click', () => this.clearMonth());
        undo.addEventListener('click', () => this.undo());

        weekdays.addEventListener('click', (e) => {
            const btn = e.target.closest('.cal-weekday');
            if (!btn || this.mode !== 'select') return;
            this.toggleWeekday(Number(btn.dataset.dow));
        });

        grid.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        grid.addEventListener('pointermove', (e) => this.onPointerMove(e));
        grid.addEventListener('pointerup', (e) => this.onPointerEnd(e));
        grid.addEventListener('pointercancel', (e) => this.onPointerEnd(e));
        grid.addEventListener('click', (e) => this.onGridClick(e));
        grid.addEventListener('keydown', (e) => this.onKeyDown(e));
        grid.addEventListener('focusin', (e) => {
            const cell = e.target.closest('.cal-day[data-iso]');
            if (cell) this.focusIso = cell.dataset.iso;
        });

        popover.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'toggle-mark' && this.popoverIso) {
                this.toggleDay(this.popoverIso);
            } else if (action === 'close-popover') {
                this.closePopover(true);
            }
        });

        document.addEventListener('pointerdown', (e) => {
            if (!this.popoverIso) return;
            const target = e.target;
            if (popover.contains(target)) return;
            if (grid.contains(target) && target.closest('.cal-day')) return;
            this.closePopover();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.popoverIso) {
                this.closePopover(true);
            }
        });
    }

    cellFromEvent(e) {
        const cell = e.target.closest?.('.cal-day[data-iso]');
        if (!cell || cell.disabled) return null;
        return cell;
    }

    onPointerDown(e) {
        if (this.mode !== 'select') return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const cell = this.cellFromEvent(e);
        if (!cell) return;
        e.preventDefault();

        const iso = cell.dataset.iso;
        this.focusIso = iso;
        this.pushUndo();

        if (e.shiftKey && this.anchorIso) {
            this.applyRange(
                this.selected,
                this.anchorIso,
                iso,
                !this.selected.has(iso)
            );
            this.anchorIso = iso;
            this.commit();
            this.focusCell();
            return;
        }

        this.drag = {
            pointerId: e.pointerId,
            start: iso,
            current: iso,
            select: !this.selected.has(iso),
            base: new Set(this.selected)
        };
        try {
            this.refs.grid.setPointerCapture(e.pointerId);
        } catch {
            // Pointer capture is a progressive enhancement.
        }
        this.paintDrag();
    }

    onPointerMove(e) {
        if (!this.drag || e.pointerId !== this.drag.pointerId) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const cell = hit?.closest?.('.cal-day[data-iso]');
        if (!cell || cell.disabled || !this.refs.grid.contains(cell)) return;
        if (cell.dataset.iso === this.drag.current) return;
        this.drag.current = cell.dataset.iso;
        this.paintDrag();
    }

    onPointerEnd(e) {
        if (!this.drag || e.pointerId !== this.drag.pointerId) return;
        this.anchorIso = this.drag.current;
        this.focusIso = this.drag.current;
        this.drag = null;
        try {
            this.refs.grid.releasePointerCapture(e.pointerId);
        } catch {
            // Already released.
        }
        this.commit();
        this.focusCell();
    }

    paintDrag() {
        const next = new Set(this.drag.base);
        this.applyRange(
            next,
            this.drag.start,
            this.drag.current,
            this.drag.select
        );
        this.selected = next;
        this.render();
    }

    onGridClick(e) {
        const cell = this.cellFromEvent(e);
        if (!cell) return;
        const iso = cell.dataset.iso;
        if (this.mode === 'compare') {
            if (this.popoverIso === iso) this.closePopover();
            else this.openPopover(iso);
            return;
        }
        // Pointer clicks are handled on pointerdown; detail === 0 means the
        // click came from the keyboard (Enter / Space).
        if (e.detail === 0) this.toggleDay(iso);
    }

    onKeyDown(e) {
        const cell = e.target.closest('.cal-day[data-iso]');
        if (!cell) return;
        const iso = cell.dataset.iso;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }

        const deltas = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -DAYS_PER_WEEK,
            ArrowDown: DAYS_PER_WEEK
        };
        if (e.key in deltas) {
            e.preventDefault();
            const target = this.clampIso(addDaysIso(iso, deltas[e.key]));
            if (target === iso) return;
            if (e.shiftKey && this.mode === 'select') {
                this.pushUndo();
                this.applyRange(this.selected, iso, target, true);
                this.anchorIso = target;
                this.focusIso = target;
                this.view = { y: parseIso(target).y, m0: parseIso(target).m0 };
                this.commit();
                this.focusCell();
            } else {
                this.moveFocus(target);
            }
            return;
        }

        if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            const { y, m0, d } = parseIso(iso);
            const delta = e.key === 'PageUp' ? -1 : 1;
            const target = fromMonthKey(monthKey(y, m0) + delta);
            const day = Math.min(d, daysInMonth(target.y, target.m0));
            this.moveFocus(toIso(target.y, target.m0, day));
        }
    }

    /* ---------- Popover ---------- */

    openPopover(iso) {
        const { grid, popover } = this.refs;
        const cell = grid.querySelector(`[data-iso="${iso}"]`);
        if (!cell) {
            this.closePopover();
            return;
        }
        this.popoverIso = iso;

        const info = this.statuses?.get(iso) || null;
        const status = info?.status || null;
        const record = info?.record || null;
        const isMarked = this.selected.has(iso);
        const meta = status ? STATUS_META[status] : null;
        const sessions = record?.sessions?.length
            ? record.sessions
            : record
              ? [record]
              : [];

        popover.dataset.status = status || 'none';
        popover.innerHTML = `
            <div class="cal-popover-head">
                <span class="cal-popover-date">${formatPopoverDate(iso)}</span>
                <button type="button" class="cal-popover-close" data-action="close-popover" aria-label="Close details">×</button>
            </div>
            ${
                meta
                    ? `<span class="cal-popover-status"><span class="cal-popover-dot"></span>${meta.label}</span>`
                    : ''
            }
            <p class="cal-popover-msg">${popoverMessage(status, record)}</p>
            ${
                sessions.length
                    ? `<ul class="cal-popover-sessions">${sessions
                          .map(
                              (s) =>
                                  `<li><span>${s.timeStr}</span><span>${s.durationMinutes} min</span></li>`
                          )
                          .join('')}</ul>`
                    : ''
            }
            <button type="button" class="cal-popover-action" data-action="toggle-mark">
                ${isMarked ? 'Unmark this day' : 'Mark as trained'}
            </button>
        `;

        popover.classList.remove('hidden');
        popover.style.visibility = 'hidden';

        const elRect = this.el.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;

        let left = cellRect.left - elRect.left + cellRect.width / 2 - width / 2;
        left = Math.max(0, Math.min(left, elRect.width - width));

        let top = cellRect.bottom - elRect.top + POPOVER_GAP_PX;
        const overflowsViewport =
            cellRect.bottom + POPOVER_GAP_PX + height > window.innerHeight;
        const fitsAbove = cellRect.top - POPOVER_GAP_PX - height > 0;
        if (overflowsViewport && fitsAbove) {
            top = cellRect.top - elRect.top - POPOVER_GAP_PX - height;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.style.visibility = '';

        grid.querySelectorAll('.is-inspected').forEach((c) =>
            c.classList.remove('is-inspected')
        );
        cell.classList.add('is-inspected');
    }

    closePopover(restoreFocus = false) {
        if (!this.popoverIso) return;
        const iso = this.popoverIso;
        this.popoverIso = null;
        this.refs.popover.classList.add('hidden');
        this.refs.grid
            .querySelectorAll('.is-inspected')
            .forEach((c) => c.classList.remove('is-inspected'));
        if (restoreFocus) {
            this.focusIso = iso;
            this.focusCell();
        }
    }

    /* ---------- Rendering ---------- */

    render() {
        const { grid, title, count, prev, next, undo, clear, hint, weekdays } =
            this.refs;

        if (!this.window || !this.view) {
            title.textContent = 'Loading…';
            count.textContent = '';
            grid.innerHTML =
                '<div class="cal-loading"><div class="loader"></div></div>';
            return;
        }

        const isCompare = this.mode === 'compare';
        const { y, m0 } = this.view;
        const monthLabel = new Date(y, m0, 1).toLocaleDateString('en-GB', {
            month: 'long',
            year: 'numeric'
        });
        title.textContent = monthLabel;
        grid.setAttribute('aria-label', monthLabel);

        const start = parseIso(this.window.start);
        const end = parseIso(this.window.end);
        const key = monthKey(y, m0);
        prev.disabled = key <= monthKey(start.y, start.m0);
        next.disabled = key >= monthKey(end.y, end.m0);

        const marked = this.countInWindow();
        count.textContent =
            marked === 1 ? '1 day marked' : `${marked} days marked`;
        count.classList.toggle('is-empty', marked === 0);

        undo.disabled = this.undoStack.length === 0;
        clear.disabled = !this.visibleMonthIsos().some((iso) =>
            this.selected.has(iso)
        );
        weekdays
            .querySelectorAll('.cal-weekday')
            .forEach((btn) => (btn.disabled = isCompare));

        if (isCompare) {
            hint.textContent = 'Tap a day for details';
        } else if (this.isCoarsePointer) {
            hint.textContent = 'Tap to mark · drag across days for a range';
        } else {
            hint.innerHTML =
                'Drag to mark a range · <kbd>Shift</kbd>+click for a span';
        }

        const cycleStarts = new Set(this.window.cycles.map((c) => c.startDate));
        const leading = weekdayIndex(y, m0, 1);
        const total = daysInMonth(y, m0);
        const isSelectedCell = (iso) =>
            this.selected.has(iso) && this.isEnabled(iso);

        let focusTarget = this.focusIso;
        const focusVisible =
            focusTarget &&
            parseIso(focusTarget).y === y &&
            parseIso(focusTarget).m0 === m0 &&
            this.isEnabled(focusTarget);
        if (!focusVisible) {
            focusTarget = this.visibleMonthIsos().at(-1) || null;
        }

        let html = '';
        for (let i = 0; i < leading; i++) {
            html +=
                '<span class="cal-day is-placeholder" aria-hidden="true"></span>';
        }

        for (let d = 1; d <= total; d++) {
            const iso = toIso(y, m0, d);
            const col = (leading + d - 1) % DAYS_PER_WEEK;
            const enabled = this.isEnabled(iso);
            const selected = isSelectedCell(iso);
            const info = isCompare ? this.statuses?.get(iso) : null;
            const status = info?.status || null;

            const classes = ['cal-day'];
            if (iso === this.window.today) classes.push('is-today');
            if (cycleStarts.has(iso)) classes.push('is-cycle-start');

            let mark = '';
            let stateLabel = '';
            if (isCompare) {
                if (status) {
                    classes.push(`st-${status}`);
                    mark = `<span class="cal-day-mark" aria-hidden="true">${STATUS_META[status].icon}</span>`;
                    stateLabel = `, ${STATUS_META[status].label}`;
                }
                if (this.filter && status !== this.filter) {
                    classes.push('is-dimmed');
                }
                if (iso === this.popoverIso) classes.push('is-inspected');
            } else if (selected) {
                classes.push('is-selected');
                stateLabel = ', marked';
                if (col > 0 && d > 1 && isSelectedCell(toIso(y, m0, d - 1))) {
                    classes.push('joins-left');
                }
                if (
                    col < LAST_COLUMN &&
                    d < total &&
                    isSelectedCell(toIso(y, m0, d + 1))
                ) {
                    classes.push('joins-right');
                }
            }

            if (
                !isCompare &&
                enabled &&
                this.lastRenderedSelected.has(iso) !== selected
            ) {
                classes.push('just-changed');
            }

            const extraLabel = [
                iso === this.window.today ? ', today' : '',
                cycleStarts.has(iso) ? ', billing cycle starts' : ''
            ].join('');
            const pressed =
                !isCompare && enabled ? ` aria-pressed="${selected}"` : '';

            html += `<button type="button" class="${classes.join(' ')}" data-iso="${iso}"${
                enabled ? '' : ' disabled'
            } tabindex="${iso === focusTarget ? 0 : -1}"${pressed} aria-label="${formatLongDate(
                iso
            )}${stateLabel}${extraLabel}" style="--i:${d}"><span class="cal-day-num">${d}</span>${mark}${
                cycleStarts.has(iso)
                    ? '<span class="cal-cycle-dot" aria-hidden="true"></span>'
                    : ''
            }</button>`;
        }

        const trailing =
            (DAYS_PER_WEEK - ((leading + total) % DAYS_PER_WEEK)) %
            DAYS_PER_WEEK;
        for (let i = 0; i < trailing; i++) {
            html +=
                '<span class="cal-day is-placeholder" aria-hidden="true"></span>';
        }

        const hadFocus = grid.contains(document.activeElement);
        grid.innerHTML = html;
        if (hadFocus) this.focusCell();

        this.lastRenderedSelected = new Set(this.selected);
    }
}
