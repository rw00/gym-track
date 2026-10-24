import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    STATUS,
    addDaysIso,
    compareAttendance,
    eachIsoInRange,
    getVerificationWindow,
    isoToDayNumber,
    dayNumberToIso,
    localTodayIso
} from '../public/attendanceCompare.js';
import { groupIntoCycles } from '../pdfParser.js';

const ANCHOR = '2026-01-05';
const TODAY = '2026-10-24';
const CYCLE_COST = 60.8;

function day(isoDate, { isCounted = true, durationMinutes = 60 } = {}) {
    return {
        isoDate,
        isCounted,
        isTooEarly: !isCounted && durationMinutes < 30,
        isThirtyMin: !isCounted && durationMinutes === 30,
        durationMinutes,
        timeStr: '18:00 - 19:00',
        sessions: []
    };
}

function windowFor(today = TODAY) {
    return getVerificationWindow({ anchorDate: ANCHOR, today });
}

describe('date helpers', () => {
    test('day number round-trips across month, year and DST boundaries', () => {
        for (const iso of [
            '2026-01-01',
            '2026-02-28',
            '2028-02-29',
            '2026-03-29',
            '2026-10-25',
            '2026-12-31'
        ]) {
            assert.equal(dayNumberToIso(isoToDayNumber(iso)), iso);
        }
    });

    test('addDaysIso rolls over months and years', () => {
        assert.equal(addDaysIso('2026-01-31', 1), '2026-02-01');
        assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
        assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
    });

    test('eachIsoInRange is inclusive', () => {
        assert.deepEqual(
            [...eachIsoInRange('2026-02-27', '2026-03-02')],
            ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']
        );
    });

    test('localTodayIso uses local calendar date', () => {
        assert.equal(localTodayIso(new Date(2026, 9, 24, 23, 59)), TODAY);
    });
});

describe('getVerificationWindow', () => {
    test('covers the current cycle plus two previous ones, ending today', () => {
        const win = windowFor();
        assert.equal(win.cycles.length, 3);
        assert.equal(win.end, TODAY);
        assert.equal(win.start, win.cycles[2].startDate);
        assert.ok(TODAY >= win.cycles[0].startDate);
        assert.ok(TODAY <= win.cycles[0].endDate);
        for (const cycle of win.cycles) {
            assert.equal(
                isoToDayNumber(cycle.endDate) - isoToDayNumber(cycle.startDate),
                27
            );
        }
    });

    test('cycle boundaries match server-side groupIntoCycles', () => {
        const win = windowFor();
        const records = win.cycles.map((c) => day(c.startDate));
        const serverCycles = groupIntoCycles(records, {
            anchorDate: ANCHOR,
            cycleCost: CYCLE_COST
        });
        assert.deepEqual(
            serverCycles.map((c) => [c.startDate, c.endDate]),
            win.cycles.map((c) => [c.startDate, c.endDate])
        );
    });

    test('today on a cycle start day makes it the newest cycle', () => {
        const win = windowFor('2026-01-05');
        assert.equal(win.cycles[0].startDate, '2026-01-05');
        assert.equal(win.cycles[2].startDate, '2025-11-10');
    });
});

describe('compareAttendance', () => {
    const win = windowFor();
    const current = win.cycles[0];
    const d = (offset) => addDaysIso(current.startDate, offset);

    test('assigns each of the five statuses', () => {
        const result = compareAttendance({
            markedDates: [d(0), d(1), d(2), TODAY],
            dailyRecords: [
                day(d(0)),
                day(d(1), { isCounted: false, durationMinutes: 20 }),
                day(d(3))
            ],
            window: win,
            cycleCost: CYCLE_COST
        });

        assert.equal(result.days.get(d(0)).status, STATUS.VERIFIED);
        assert.equal(result.days.get(d(1)).status, STATUS.NOT_COUNTED);
        assert.equal(result.days.get(d(2)).status, STATUS.MISSING);
        assert.equal(result.days.get(d(3)).status, STATUS.UNMARKED);
        assert.equal(result.days.get(TODAY).status, STATUS.PENDING);
        assert.deepEqual(result.counts, {
            marked: 4,
            verified: 1,
            notCounted: 1,
            missing: 1,
            unmarked: 1,
            pending: 1
        });
        assert.equal(result.totals.verifiable, 3);
    });

    test('today with a PDF record is verified, not pending', () => {
        const result = compareAttendance({
            markedDates: [TODAY],
            dailyRecords: [day(TODAY)],
            window: win,
            cycleCost: CYCLE_COST
        });
        assert.equal(result.days.get(TODAY).status, STATUS.VERIFIED);
    });

    test('ignores marks and records outside the window', () => {
        const before = addDaysIso(win.start, -1);
        const after = addDaysIso(TODAY, 1);
        const result = compareAttendance({
            markedDates: [before, after],
            dailyRecords: [day(before)],
            window: win,
            cycleCost: CYCLE_COST
        });
        assert.equal(result.days.size, 0);
        assert.equal(result.hasMarks, false);
    });

    test('empty selection still reports unmarked PDF days', () => {
        const result = compareAttendance({
            markedDates: [],
            dailyRecords: [day(d(0)), day(d(4))],
            window: win,
            cycleCost: CYCLE_COST
        });
        assert.equal(result.hasMarks, false);
        assert.equal(result.counts.unmarked, 2);
        assert.equal(result.totals.overcharge, 0);
    });

    test('computes per-cycle bank charge vs corrected charge', () => {
        const previous = win.cycles[1];
        const p = (offset) => addDaysIso(previous.startDate, offset);
        const result = compareAttendance({
            markedDates: [p(0), p(1), p(2), p(3), p(4)],
            dailyRecords: [day(p(0)), day(p(1)), day(p(2)), day(p(10))],
            window: win,
            cycleCost: CYCLE_COST,
            discountPerVisit: 1
        });

        const cycle = result.cycles[1];
        assert.equal(cycle.startDate, previous.startDate);
        assert.equal(cycle.gymCounted, 4);
        assert.equal(cycle.missing, 2);
        assert.deepEqual(cycle.missingDates, [p(4), p(3)]);
        assert.equal(cycle.gymPayment, 56.8);
        assert.equal(cycle.correctedCount, 6);
        assert.equal(cycle.correctedPayment, 54.8);
        assert.equal(cycle.overcharge, 2);
        assert.equal(result.totals.overcharge, 2);
        assert.equal(result.totals.overchargedCycles, 1);
    });

    test('not-counted visits do not add to the overcharge', () => {
        const result = compareAttendance({
            markedDates: [d(0)],
            dailyRecords: [
                day(d(0), { isCounted: false, durationMinutes: 30 })
            ],
            window: win,
            cycleCost: CYCLE_COST
        });
        assert.equal(result.days.get(d(0)).status, STATUS.NOT_COUNTED);
        assert.equal(result.totals.overcharge, 0);
    });

    test('overcharge respects the discount cap at the base cost', () => {
        const result = compareAttendance({
            markedDates: [d(0), d(1)],
            dailyRecords: [day(d(0))],
            window: win,
            cycleCost: 1,
            discountPerVisit: 1
        });
        assert.equal(result.cycles[0].missing, 1);
        assert.equal(result.cycles[0].gymPayment, 0);
        assert.equal(result.cycles[0].overcharge, 0);
    });

    test('a PDF day with multiple sessions uses the daily record', () => {
        const record = {
            ...day(d(0)),
            sessions: [
                { timeStr: '07:00 - 07:05', durationMinutes: 5 },
                { timeStr: '18:00 - 19:00', durationMinutes: 60 }
            ]
        };
        const result = compareAttendance({
            markedDates: [d(0)],
            dailyRecords: [record],
            window: win,
            cycleCost: CYCLE_COST
        });
        assert.equal(result.days.get(d(0)).status, STATUS.VERIFIED);
        assert.equal(result.days.get(d(0)).record.sessions.length, 2);
    });
});
