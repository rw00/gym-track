/**
 * Attendance verification logic.
 *
 * Compares the days a user marked as "trained" against the daily records
 * parsed from the gym's check-in PDF, scoped to the most recent billing
 * cycles. Pure functions only (no DOM), so this module runs both in the
 * browser and under `node --test`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_PAD_LENGTH = 2;
const CURRENCY_FACTOR = 100;

export const VERIFY_CYCLE_COUNT = 3;
export const VERIFY_CYCLE_LENGTH_DAYS = 28;

export const STATUS = Object.freeze({
    VERIFIED: 'verified',
    NOT_COUNTED: 'not-counted',
    MISSING: 'missing',
    UNMARKED: 'unmarked',
    PENDING: 'pending'
});

const STATUS_COUNT_KEY = Object.freeze({
    [STATUS.VERIFIED]: 'verified',
    [STATUS.NOT_COUNTED]: 'notCounted',
    [STATUS.MISSING]: 'missing',
    [STATUS.UNMARKED]: 'unmarked',
    [STATUS.PENDING]: 'pending'
});

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) {
    return String(n).padStart(ISO_PAD_LENGTH, '0');
}

function roundCurrency(value) {
    return Math.round(value * CURRENCY_FACTOR) / CURRENCY_FACTOR;
}

export function isIsoDate(value) {
    return typeof value === 'string' && ISO_DATE_REGEX.test(value);
}

/** Days since the Unix epoch for a YYYY-MM-DD string (timezone-agnostic). */
export function isoToDayNumber(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function dayNumberToIso(dayNumber) {
    const date = new Date(dayNumber * MS_PER_DAY);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDaysIso(iso, days) {
    return dayNumberToIso(isoToDayNumber(iso) + days);
}

/** Today's date in the user's local timezone, as YYYY-MM-DD. */
export function localTodayIso(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function* eachIsoInRange(startIso, endIso) {
    const end = isoToDayNumber(endIso);
    for (let n = isoToDayNumber(startIso); n <= end; n++) {
        yield dayNumberToIso(n);
    }
}

/**
 * The verification window: the billing cycle containing `today` plus the
 * previous `cycleCount - 1` cycles. Uses the same 28-day arithmetic as the
 * server-side `groupIntoCycles`, so cycle boundaries line up with the report.
 * Days after `today` are never part of the window.
 */
export function getVerificationWindow({
    anchorDate,
    today,
    cycleCount = VERIFY_CYCLE_COUNT,
    cycleLengthDays = VERIFY_CYCLE_LENGTH_DAYS
}) {
    const anchor = isoToDayNumber(anchorDate);
    const todayNumber = isoToDayNumber(today);
    const currentIndex = Math.floor((todayNumber - anchor) / cycleLengthDays);

    const cycles = [];
    for (let i = 0; i < cycleCount; i++) {
        const cycleIndex = currentIndex - i;
        const start = anchor + cycleIndex * cycleLengthDays;
        cycles.push({
            cycleIndex,
            startDate: dayNumberToIso(start),
            endDate: dayNumberToIso(start + cycleLengthDays - 1)
        });
    }

    return {
        start: cycles.at(-1).startDate,
        end: today,
        today,
        cycles
    };
}

function findCycle(cycles, iso) {
    return cycles.find((c) => iso >= c.startDate && iso <= c.endDate) || null;
}

function paymentFor(baseCost, countedDays, discountPerVisit) {
    const discount = Math.min(baseCost, countedDays * discountPerVisit);
    return roundCurrency(Math.max(0, baseCost - discount));
}

/**
 * Compare marked days with the PDF's daily records.
 *
 * Status per day (only days that are marked and/or recorded get a status):
 * - verified:    marked, and the gym counted it
 * - not-counted: marked, the gym recorded a visit but it was too short
 * - missing:     marked, no check-in in the PDF at all
 * - unmarked:    not marked, but the PDF has a check-in
 * - pending:     marked today but not in the PDF yet (export may predate visit)
 *
 * Money (per cycle, matching what the bank charges):
 * - gymPayment:       what the gym charges based on its own count
 * - correctedPayment: what it should be if every missing day were counted
 * - overcharge:       gymPayment - correctedPayment
 */
export function compareAttendance({
    markedDates,
    dailyRecords = [],
    window,
    cycleCost,
    discountPerVisit = 1
}) {
    const marked = new Set(markedDates || []);
    const recordsByDate = new Map();
    for (const record of dailyRecords) {
        if (record && isIsoDate(record.isoDate)) {
            recordsByDate.set(record.isoDate, record);
        }
    }

    const counts = {
        marked: 0,
        verified: 0,
        notCounted: 0,
        missing: 0,
        unmarked: 0,
        pending: 0
    };

    const cycles = window.cycles.map((c) => ({
        ...c,
        baseCost: cycleCost,
        marked: 0,
        verified: 0,
        notCounted: 0,
        missing: 0,
        unmarked: 0,
        pending: 0,
        gymCounted: 0,
        missingDates: []
    }));

    for (const record of recordsByDate.values()) {
        if (!record.isCounted) continue;
        const cycle = findCycle(cycles, record.isoDate);
        if (cycle) cycle.gymCounted += 1;
    }

    const days = new Map();
    for (const iso of eachIsoInRange(window.start, window.end)) {
        const isMarked = marked.has(iso);
        const record = recordsByDate.get(iso) || null;

        let status = null;
        if (isMarked && record) {
            status = record.isCounted ? STATUS.VERIFIED : STATUS.NOT_COUNTED;
        } else if (isMarked) {
            status = iso === window.today ? STATUS.PENDING : STATUS.MISSING;
        } else if (record) {
            status = STATUS.UNMARKED;
        }
        if (!status) continue;

        days.set(iso, { status, marked: isMarked, record });

        const key = STATUS_COUNT_KEY[status];
        counts[key] += 1;
        if (isMarked) counts.marked += 1;

        const cycle = findCycle(cycles, iso);
        if (cycle) {
            cycle[key] += 1;
            if (isMarked) cycle.marked += 1;
            if (status === STATUS.MISSING) cycle.missingDates.push(iso);
        }
    }

    let overcharge = 0;
    for (const cycle of cycles) {
        cycle.correctedCount = cycle.gymCounted + cycle.missing;
        cycle.gymPayment = paymentFor(
            cycle.baseCost,
            cycle.gymCounted,
            discountPerVisit
        );
        cycle.correctedPayment = paymentFor(
            cycle.baseCost,
            cycle.correctedCount,
            discountPerVisit
        );
        cycle.overcharge = roundCurrency(
            cycle.gymPayment - cycle.correctedPayment
        );
        cycle.missingDates.sort((a, b) => b.localeCompare(a));
        overcharge += cycle.overcharge;
    }

    return {
        days,
        counts,
        cycles,
        hasMarks: counts.marked > 0,
        totals: {
            overcharge: roundCurrency(overcharge),
            overchargedCycles: cycles.filter((c) => c.overcharge > 0).length,
            verifiable: counts.marked - counts.pending
        }
    };
}
