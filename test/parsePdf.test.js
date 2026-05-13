import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Temporal } from 'temporal-polyfill';
import {
    parsePdfBuffer,
    extractRecordsFromText,
    evaluateDailyAttendance,
    groupIntoCycles,
    MIN_ATTENDANCE_MINUTES,
    SAFE_MIN_ATTENDANCE_MINUTES,
    DEFAULT_CYCLE_LIMIT,
    DEFAULT_CYCLE_COST,
    DEFAULT_DISCOUNT_PER_VISIT,
    CYCLE_LENGTH_DAYS,
    CURRENCY_DECIMAL_PLACES
} from '../pdfParser.js';

import fsSync from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let PDF_PATH = path.join(__dirname, '..', 'check-in-history.pdf');
if (!fsSync.existsSync(PDF_PATH)) {
    PDF_PATH = path.join(__dirname, '..', 'examples', 'check-in-history.pdf');
}

const EXPECTED_2026_RAW_RECORDS = 184;
const CYCLE_1_VALID_COUNT = 18;
const CYCLE_2_VALID_COUNT = 18;
const CYCLE_3_VALID_COUNT = 6;
const TOTAL_EXPECTED_COUNTED =
    CYCLE_1_VALID_COUNT + CYCLE_2_VALID_COUNT + CYCLE_3_VALID_COUNT;
const TOTAL_EXPECTED_DISCOUNT =
    TOTAL_EXPECTED_COUNTED * DEFAULT_DISCOUNT_PER_VISIT;

const TOTAL_HISTORICAL_RAW_RECORDS = 329;
const TOTAL_HISTORICAL_CYCLES = 16;
const GLITCH_CYCLE_VALID_COUNT = 20;

const TEST_YEAR_2026 = 2026;
const TEST_YEAR_2025 = 2025;
const TEST_RAW_SAMPLE_COUNT = 7;
const TEST_DAYS_COUNT = 5;
const TEST_VALID_DAYS_COUNT = 3;
const TEST_THIRTY_MIN_COUNT = 1;
const TEST_TOO_EARLY_COUNT = 1;

describe('PDF Check-in History Parser', () => {
    test(`parses check-in-history.pdf and reports the last ${DEFAULT_CYCLE_LIMIT} cycles by default`, async (t) => {
        let buffer;
        try {
            buffer = await fs.readFile(PDF_PATH);
        } catch {
            t.skip('check-in-history.pdf not found');
            return;
        }
        const report = await parsePdfBuffer(buffer, {
            cycleCost: DEFAULT_CYCLE_COST,
            minAttendanceMinutes: SAFE_MIN_ATTENDANCE_MINUTES,
            cycleLimit: DEFAULT_CYCLE_LIMIT
        });

        assert.equal(
            report.rawCount,
            EXPECTED_2026_RAW_RECORDS,
            `Total raw check-in lines in PDF should be ${EXPECTED_2026_RAW_RECORDS} for current year 2026`
        );

        assert.equal(
            report.cycles.length,
            DEFAULT_CYCLE_LIMIT,
            `Report should contain exactly ${DEFAULT_CYCLE_LIMIT} cycles`
        );
        assert.equal(
            report.summary.totalCycles,
            DEFAULT_CYCLE_LIMIT,
            `Summary should report ${DEFAULT_CYCLE_LIMIT} cycles`
        );

        const c1 = report.cycles[0];
        assert.equal(c1.startDate, '2026-08-17');
        assert.equal(c1.endDate, '2026-09-13');
        assert.equal(
            c1.validCount,
            CYCLE_1_VALID_COUNT,
            `Cycle 1 should have ${CYCLE_1_VALID_COUNT} visits`
        );
        assert.equal(c1.tooEarlyCount, 0);
        assert.equal(
            c1.expectedPayment,
            Number(
                (
                    DEFAULT_CYCLE_COST -
                    c1.validCount * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        );

        const c2 = report.cycles[1];
        assert.equal(c2.startDate, '2026-07-20');
        assert.equal(c2.endDate, '2026-08-16');
        assert.equal(
            c2.validCount,
            CYCLE_2_VALID_COUNT,
            `Cycle 2 should have ${CYCLE_2_VALID_COUNT} visits`
        );
        assert.equal(c2.tooEarlyCount, 0);
        assert.equal(
            c2.expectedPayment,
            Number(
                (
                    DEFAULT_CYCLE_COST -
                    c2.validCount * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        );

        const c3 = report.cycles[2];
        assert.equal(c3.startDate, '2026-06-22');
        assert.equal(c3.endDate, '2026-07-19');
        assert.equal(
            c3.validCount,
            CYCLE_3_VALID_COUNT,
            `Cycle 3 should have ${CYCLE_3_VALID_COUNT} visits`
        );
        assert.equal(c3.tooEarlyCount, 0);
        assert.equal(
            c3.expectedPayment,
            Number(
                (
                    DEFAULT_CYCLE_COST -
                    c3.validCount * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        );

        assert.equal(
            report.summary.totalCounted,
            TOTAL_EXPECTED_COUNTED,
            `${CYCLE_1_VALID_COUNT} + ${CYCLE_2_VALID_COUNT} + ${CYCLE_3_VALID_COUNT} = ${TOTAL_EXPECTED_COUNTED} workouts counted across last ${DEFAULT_CYCLE_LIMIT} cycles`
        );
        assert.equal(report.summary.totalTooEarly, 0);
        assert.equal(report.summary.totalDiscount, TOTAL_EXPECTED_DISCOUNT);
    });

    test('deduplicates multiple entries on the same day (glitch handling on 29/09/2025)', async (t) => {
        let buffer;
        try {
            buffer = await fs.readFile(PDF_PATH);
        } catch {
            t.skip('check-in-history.pdf not found');
            return;
        }
        const report = await parsePdfBuffer(buffer, {
            cycleCost: DEFAULT_CYCLE_COST,
            minAttendanceMinutes: SAFE_MIN_ATTENDANCE_MINUTES,
            cycleLimit: 0,
            checkYearDbExists: () => false
        });

        assert.equal(report.rawCount, TOTAL_HISTORICAL_RAW_RECORDS);
        assert.equal(report.allCycles.length, TOTAL_HISTORICAL_CYCLES);

        const cycleWithGlitch = report.allCycles.find(
            (c) => c.startDate === '2025-09-15' && c.endDate === '2025-10-12'
        );
        assert.ok(cycleWithGlitch);

        assert.equal(
            cycleWithGlitch.validCount,
            GLITCH_CYCLE_VALID_COUNT,
            `Should count ${GLITCH_CYCLE_VALID_COUNT} distinct workout days`
        );
        assert.equal(
            cycleWithGlitch.tooEarlyCount,
            0,
            'The 0 min entry on the same day as 74 min is a glitch and NOT an early exit'
        );
        assert.equal(
            cycleWithGlitch.expectedPayment,
            Number(
                (
                    DEFAULT_CYCLE_COST -
                    cycleWithGlitch.validCount * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        );
    });

    test('halts line-by-line parsing immediately when encountering a previous year with existing YYYY-db.json', () => {
        const text = `
Date Time Studio
05/09/2026 09:00 - 10:00 Gym
04/09/2026 09:00 - 10:00 Gym
31/12/2025 09:00 - 10:00 Gym
30/12/2025 09:00 - 10:00 Gym
29/12/2024 09:00 - 10:00 Gym
        `;
        const records = extractRecordsFromText(
            text,
            SAFE_MIN_ATTENDANCE_MINUTES,
            {
                currentYear: TEST_YEAR_2026,
                checkYearDbExists: (year) => year === TEST_YEAR_2025
            }
        );

        assert.equal(records.length, 2);
        assert.equal(records[0].isoDate, '2026-09-04');
        assert.equal(records[1].isoDate, '2026-09-05');
    });

    test('validates duration threshold (30 + 1 min = 31 min), 30 min highlight, and max 1 entry per day rule', () => {
        const sampleText = `
Date Time Studio
01/01/2026 08:00 - 08:31 Gym
02/01/2026 08:00 - 08:30 Gym
03/01/2026 08:00 - 08:15 Gym
03/01/2026 18:00 - 19:00 Gym
04/01/2026 08:00 - 08:20 Gym
05/01/2026 08:00 - 09:00 Gym
05/01/2026 17:00 - 18:00 Gym
        `;

        const raw = extractRecordsFromText(
            sampleText,
            SAFE_MIN_ATTENDANCE_MINUTES
        );
        assert.equal(raw.length, TEST_RAW_SAMPLE_COUNT);

        assert.equal(raw[0].durationMinutes, SAFE_MIN_ATTENDANCE_MINUTES);
        assert.equal(raw[0].isValid, true);

        assert.equal(raw[1].durationMinutes, MIN_ATTENDANCE_MINUTES);
        assert.equal(raw[1].isValid, false);

        const days = evaluateDailyAttendance(raw, SAFE_MIN_ATTENDANCE_MINUTES);
        assert.equal(days.length, TEST_DAYS_COUNT);

        assert.equal(days[0].isCounted, true);
        assert.equal(days[0].isTooEarly, false);
        assert.equal(days[0].isThirtyMin, false);

        assert.equal(days[1].isCounted, false);
        assert.equal(days[1].isThirtyMin, true);
        assert.equal(days[1].isTooEarly, false);

        assert.equal(days[2].isCounted, true);
        assert.equal(days[2].isTooEarly, false);

        assert.equal(days[3].isCounted, false);
        assert.equal(days[3].isTooEarly, true);

        assert.equal(days[4].isCounted, true);

        const cycles = groupIntoCycles(days, {
            anchorDate: '2025-12-29',
            cycleCost: DEFAULT_CYCLE_COST
        });
        assert.equal(cycles.length, 1);
        const cycle = cycles[0];
        assert.equal(
            Temporal.PlainDate.from(cycle.endDate).since(
                Temporal.PlainDate.from(cycle.startDate),
                { largestUnit: 'days' }
            ).days + 1,
            CYCLE_LENGTH_DAYS
        );

        assert.equal(cycle.validCount, TEST_VALID_DAYS_COUNT);
        assert.equal(cycle.thirtyMinCount, TEST_THIRTY_MIN_COUNT);
        assert.equal(cycle.tooEarlyCount, TEST_TOO_EARLY_COUNT);
        assert.equal(
            cycle.expectedPayment,
            Number(
                (
                    DEFAULT_CYCLE_COST -
                    cycle.validCount * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        );
    });
});
