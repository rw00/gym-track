import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parsePdfBuffer,
    SAFE_MIN_ATTENDANCE_MINUTES,
    MIN_ATTENDANCE_MINUTES,
    DEFAULT_CYCLE_COST
} from '../pdfParser.js';
import {
    syncAttendanceRecords,
    readDB,
    writeDB,
    ensurePartitionedByYear,
    getYearDbPath
} from '../server.js';
import { DIRECT_CHECKOUT_DURATION_MINUTES } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let PDF_PATH = path.join(__dirname, '..', 'check-in-history.pdf');
if (!fsSync.existsSync(PDF_PATH)) {
    PDF_PATH = path.join(__dirname, '..', 'examples', 'check-in-history.pdf');
}
const TEST_DB_PATH = path.join(__dirname, 'test-db.json');

const TEST_CURRENT_YEAR = 2026;
const TEST_PREVIOUS_YEAR = 2025;
const TEST_2025_DB_PATH = getYearDbPath(TEST_PREVIOUS_YEAR, TEST_DB_PATH);

const DURATION_SHORT_DISCARDED = MIN_ATTENDANCE_MINUTES - 10;
const DURATION_WORKOUT_54 = 54;
const DURATION_WORKOUT_45 = 45;
const DURATION_WORKOUT_50 = 50;
const DURATION_WORKOUT_60 = 60;
const DURATION_WORKOUT_75 = 75;
const EXPECTED_2026_DAYS_COUNT = 184;
const LAST_2026_INDEX = EXPECTED_2026_DAYS_COUNT - 1;
const EXPECTED_COUNT_2 = 2;
const EXPECTED_COUNT_1 = 1;

describe('Database Sync after PDF Processing', () => {
    beforeEach(async () => {
        await writeDB({ attendance: [], activeSession: null }, TEST_DB_PATH);
        try {
            await fs.unlink(TEST_2025_DB_PATH);
        } catch {
            // Ignore if not present
        }
    });

    afterEach(async () => {
        try {
            await fs.unlink(TEST_DB_PATH);
        } catch {
            // Ignore if already deleted
        }
        try {
            await fs.unlink(TEST_2025_DB_PATH);
        } catch {
            // Ignore if already deleted
        }
    });

    test('syncs parsed daily records to db.json in live tracker schema for current year', async () => {
        const sampleDailyRecords = [
            {
                isoDate: '2026-09-05',
                startTime: '09:23',
                durationMinutes: SAFE_MIN_ATTENDANCE_MINUTES,
                isCounted: true
            },
            {
                isoDate: '2026-09-04',
                startTime: '08:03',
                durationMinutes: DURATION_WORKOUT_54,
                isCounted: true
            },
            {
                isoDate: '2026-09-03',
                startTime: '08:00',
                durationMinutes: DURATION_SHORT_DISCARDED,
                isCounted: false
            }
        ];

        const result = await syncAttendanceRecords(
            sampleDailyRecords,
            TEST_DB_PATH,
            TEST_CURRENT_YEAR
        );

        assert.equal(result.updated, true);
        assert.equal(result.addedOrUpdatedCount, EXPECTED_COUNT_2);
        assert.equal(result.totalAttendance, EXPECTED_COUNT_2);

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.attendance.length, EXPECTED_COUNT_2);

        assert.equal(db.attendance[0].date, '2026-09-04');
        assert.equal(db.attendance[1].date, '2026-09-05');

        const rec = db.attendance[1];
        assert.equal(rec.date, '2026-09-05');
        assert.equal(rec.durationMinutes, SAFE_MIN_ATTENDANCE_MINUTES);
        assert.equal(rec.method, 'standard');
        assert.match(
            rec.startTime,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
        );
        assert.match(
            rec.endTime,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
        );
    });

    test('preserves existing attendance on un-synced dates and active session', async () => {
        await writeDB(
            {
                attendance: [
                    {
                        date: '2026-09-06',
                        startTime: '2026-09-06T08:00:00Z',
                        endTime: '2026-09-06T09:00:00Z',
                        durationMinutes: DURATION_WORKOUT_60,
                        method: 'direct-checkout'
                    }
                ],
                activeSession: {
                    startTime: '2026-09-06T10:00:00Z',
                    date: '2026-09-06'
                }
            },
            TEST_DB_PATH
        );

        const sampleDailyRecords = [
            {
                isoDate: '2026-09-05',
                startTime: '09:00',
                durationMinutes: DURATION_WORKOUT_45,
                isCounted: true
            }
        ];

        await syncAttendanceRecords(
            sampleDailyRecords,
            TEST_DB_PATH,
            TEST_CURRENT_YEAR
        );

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.attendance.length, EXPECTED_COUNT_2);

        assert.deepEqual(db.activeSession, {
            startTime: '2026-09-06T10:00:00Z',
            date: '2026-09-06'
        });

        assert.equal(db.attendance[0].date, '2026-09-05');
        assert.equal(db.attendance[1].date, '2026-09-06');
        assert.equal(db.attendance[1].method, 'direct-checkout');
    });

    test('updates existing date if PDF provides official session info without creating duplicate', async () => {
        await writeDB(
            {
                attendance: [
                    {
                        date: '2026-09-05',
                        startTime: '2026-09-05T08:00:00Z',
                        endTime: '2026-09-05T08:00:00Z',
                        durationMinutes: DIRECT_CHECKOUT_DURATION_MINUTES,
                        method: 'direct-checkout'
                    }
                ],
                activeSession: null
            },
            TEST_DB_PATH
        );

        const sampleDailyRecords = [
            {
                isoDate: '2026-09-05',
                startTime: '09:23',
                durationMinutes: SAFE_MIN_ATTENDANCE_MINUTES,
                isCounted: true
            }
        ];

        await syncAttendanceRecords(
            sampleDailyRecords,
            TEST_DB_PATH,
            TEST_CURRENT_YEAR
        );

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.attendance.length, EXPECTED_COUNT_1);
        assert.equal(db.attendance[0].date, '2026-09-05');
        assert.equal(
            db.attendance[0].durationMinutes,
            SAFE_MIN_ATTENDANCE_MINUTES
        );
        assert.equal(db.attendance[0].method, 'standard');
    });

    test('partitions previous year records into YYYY-db.json when syncAttendanceRecords is called', async () => {
        const sampleDailyRecords = [
            {
                isoDate: '2026-09-05',
                startTime: '09:00',
                durationMinutes: DURATION_WORKOUT_45,
                isCounted: true
            },
            {
                isoDate: '2025-12-30',
                startTime: '08:00',
                durationMinutes: DURATION_WORKOUT_50,
                isCounted: true
            }
        ];

        await syncAttendanceRecords(
            sampleDailyRecords,
            TEST_DB_PATH,
            TEST_CURRENT_YEAR
        );

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.attendance.length, EXPECTED_COUNT_1);
        assert.equal(db.attendance[0].date, '2026-09-05');

        const db2025 = await readDB(TEST_2025_DB_PATH);
        assert.equal(db2025.attendance.length, EXPECTED_COUNT_1);
        assert.equal(db2025.attendance[0].date, '2025-12-30');
    });

    test('ensurePartitionedByYear splits legacy multi-year records in db.json', async () => {
        await writeDB(
            {
                attendance: [
                    {
                        date: '2025-06-24',
                        startTime: '2025-06-24T18:55:00Z',
                        endTime: '2025-06-24T20:10:00Z',
                        durationMinutes: DURATION_WORKOUT_75,
                        method: 'standard'
                    },
                    {
                        date: '2026-01-01',
                        startTime: '2026-01-01T08:00:00Z',
                        endTime: '2026-01-01T09:00:00Z',
                        durationMinutes: DURATION_WORKOUT_60,
                        method: 'standard'
                    }
                ],
                activeSession: null
            },
            TEST_DB_PATH
        );

        await ensurePartitionedByYear(TEST_DB_PATH, TEST_CURRENT_YEAR);

        const currentDb = await readDB(TEST_DB_PATH);
        assert.equal(currentDb.attendance.length, EXPECTED_COUNT_1);
        assert.equal(currentDb.attendance[0].date, '2026-01-01');

        const pastDb = await readDB(TEST_2025_DB_PATH);
        assert.equal(pastDb.attendance.length, EXPECTED_COUNT_1);
        assert.equal(pastDb.attendance[0].date, '2025-06-24');
    });

    test('end-to-end: parses check-in-history.pdf and syncs current year (184 valid days) to db.json', async (t) => {
        let buffer;
        try {
            buffer = await fs.readFile(PDF_PATH);
        } catch {
            t.skip('check-in-history.pdf not found');
            return;
        }

        await writeDB({ attendance: [] }, TEST_2025_DB_PATH);

        const report = await parsePdfBuffer(buffer, {
            cycleCost: DEFAULT_CYCLE_COST,
            minAttendanceMinutes: SAFE_MIN_ATTENDANCE_MINUTES,
            cycleLimit: 0,
            currentYear: TEST_CURRENT_YEAR,
            dbDir: path.dirname(TEST_DB_PATH)
        });

        assert.equal(
            report.dailyRecords.length,
            EXPECTED_2026_DAYS_COUNT,
            `Should only parse ${EXPECTED_2026_DAYS_COUNT} days for current year ${TEST_CURRENT_YEAR} due to early stopping`
        );

        const syncResult = await syncAttendanceRecords(
            report.dailyRecords,
            TEST_DB_PATH,
            TEST_CURRENT_YEAR
        );

        assert.equal(syncResult.updated, true);
        assert.equal(syncResult.addedOrUpdatedCount, EXPECTED_2026_DAYS_COUNT);
        assert.equal(syncResult.totalAttendance, EXPECTED_2026_DAYS_COUNT);

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.attendance.length, EXPECTED_2026_DAYS_COUNT);

        assert.equal(db.attendance[0].date, '2026-01-01');
        assert.equal(db.attendance[LAST_2026_INDEX].date, '2026-09-05');

        for (const entry of db.attendance) {
            assert.match(entry.date, /^2026-\d{2}-\d{2}$/);
            assert.match(
                entry.startTime,
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
            );
            assert.match(
                entry.endTime,
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
            );
            assert.ok(entry.durationMinutes >= SAFE_MIN_ATTENDANCE_MINUTES);
            assert.equal(entry.method, 'standard');
        }
    });
});
