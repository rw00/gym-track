import { PDFParse } from 'pdf-parse';
import { Temporal } from 'temporal-polyfill';
import fs from 'node:fs';
import path from 'node:path';
import {
    MIN_ATTENDANCE_MINUTES,
    SAFE_MIN_ATTENDANCE_MINUTES,
    DEFAULT_CYCLE_LIMIT,
    CYCLE_LENGTH_DAYS,
    CYCLE_END_DAY_OFFSET,
    DEFAULT_CYCLE_COST,
    DEFAULT_DISCOUNT_PER_VISIT,
    DEFAULT_CYCLE_ANCHOR_DATE as DEFAULT_ANCHOR_DATE,
    CURRENCY_DECIMAL_PLACES,
    MINUTES_PER_HOUR,
    MINUTES_PER_DAY,
    DATE_PAD_LENGTH
} from './config.js';

export {
    MIN_ATTENDANCE_MINUTES,
    SAFE_MIN_ATTENDANCE_MINUTES,
    DEFAULT_CYCLE_LIMIT,
    CYCLE_LENGTH_DAYS,
    CYCLE_END_DAY_OFFSET,
    DEFAULT_CYCLE_COST,
    DEFAULT_DISCOUNT_PER_VISIT,
    DEFAULT_ANCHOR_DATE,
    CURRENCY_DECIMAL_PLACES,
    MINUTES_PER_HOUR,
    MINUTES_PER_DAY
};

export function extractRecordsFromText(
    text,
    minAttendanceMinutesOrOptions = SAFE_MIN_ATTENDANCE_MINUTES,
    options = {}
) {
    let minAttendanceMinutes;
    let opts = {};
    if (
        typeof minAttendanceMinutesOrOptions === 'object' &&
        minAttendanceMinutesOrOptions !== null
    ) {
        opts = minAttendanceMinutesOrOptions;
        minAttendanceMinutes =
            opts.minAttendanceMinutes ?? SAFE_MIN_ATTENDANCE_MINUTES;
    } else {
        minAttendanceMinutes =
            minAttendanceMinutesOrOptions ?? SAFE_MIN_ATTENDANCE_MINUTES;
        opts = options;
    }

    const currentYear =
        opts.currentYear ??
        Temporal.Now.zonedDateTimeISO(opts.timezone || 'Europe/Amsterdam').year;
    const dbDir = opts.dbDir ?? process.cwd();

    const checkYearDbExists =
        opts.checkYearDbExists ??
        ((year) => fs.existsSync(path.join(dbDir, `${year}-db.json`)));

    const lines = text.split('\n');
    const dateRegex = /(\d{2}\/\d{2}\/\d{4})\s+([0-9:]+\s*-\s*[0-9:]+)(.*)/;

    const rawRecords = [];

    for (const line of lines) {
        const match = new RegExp(dateRegex).exec(line);
        if (!match) continue;

        const [, dateStr, timeStr] = match;
        const [day, month, year] = dateStr.split('/').map(Number);

        if (year !== currentYear) {
            if (checkYearDbExists(year)) {
                break;
            }
        }

        const isoDate = `${year}-${String(month).padStart(DATE_PAD_LENGTH, '0')}-${String(day).padStart(DATE_PAD_LENGTH, '0')}`;

        const [startTime, endTime] = timeStr.split('-').map((s) => s.trim());
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);

        let durationMinutes =
            endH * MINUTES_PER_HOUR +
            endM -
            (startH * MINUTES_PER_HOUR + startM);
        if (durationMinutes < 0) {
            durationMinutes += MINUTES_PER_DAY;
        }

        const isValid = durationMinutes >= minAttendanceMinutes;

        rawRecords.push({
            dateStr,
            isoDate,
            timeStr: `${startTime} - ${endTime}`,
            startTime,
            endTime,
            durationMinutes,
            isValid
        });
    }

    rawRecords.sort(
        (a, b) =>
            a.isoDate.localeCompare(b.isoDate) ||
            a.startTime.localeCompare(b.startTime)
    );

    return rawRecords;
}

export function evaluateDailyAttendance(
    rawRecords,
    minAttendanceMinutes = SAFE_MIN_ATTENDANCE_MINUTES
) {
    const daysMap = new Map();

    for (const record of rawRecords) {
        if (!daysMap.has(record.isoDate)) {
            daysMap.set(record.isoDate, []);
        }
        daysMap.get(record.isoDate).push(record);
    }

    const processedDays = [];

    for (const [isoDate, sessions] of daysMap.entries()) {
        const validSession = sessions.find(
            (s) => s.durationMinutes >= minAttendanceMinutes
        );

        if (validSession) {
            processedDays.push({
                isoDate,
                dateStr: sessions[0].dateStr,
                isValid: true,
                isCounted: true,
                isTooEarly: false,
                isThirtyMin: false,
                durationMinutes: validSession.durationMinutes,
                timeStr: validSession.timeStr,
                startTime: validSession.startTime,
                endTime: validSession.endTime,
                sessions: sessions.map((s) => ({
                    ...s,
                    isGlitchDuplicate:
                        s !== validSession &&
                        s.durationMinutes < minAttendanceMinutes
                }))
            });
        } else {
            const longestSession = [...sessions].sort(
                (a, b) => b.durationMinutes - a.durationMinutes
            )[0];
            const isThirtyMin =
                longestSession.durationMinutes === MIN_ATTENDANCE_MINUTES;
            const isTooEarly =
                longestSession.durationMinutes < MIN_ATTENDANCE_MINUTES;

            processedDays.push({
                isoDate,
                dateStr: sessions[0].dateStr,
                isValid: false,
                isCounted: false,
                isThirtyMin,
                isTooEarly,
                durationMinutes: longestSession.durationMinutes,
                timeStr: longestSession.timeStr,
                startTime: longestSession.startTime,
                endTime: longestSession.endTime,
                sessions
            });
        }
    }

    processedDays.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    return processedDays;
}

export function groupIntoCycles(dailyRecords, options = {}) {
    const anchorDateStr = options.anchorDate || DEFAULT_ANCHOR_DATE;
    const cycleCost = options.cycleCost ?? DEFAULT_CYCLE_COST;
    const discountPerVisit =
        options.discountPerVisit ?? DEFAULT_DISCOUNT_PER_VISIT;

    const anchorDate = Temporal.PlainDate.from(anchorDateStr);
    const cycleMap = new Map();

    for (const day of dailyRecords) {
        const date = Temporal.PlainDate.from(day.isoDate);
        const diffDays = date.since(anchorDate, { largestUnit: 'days' }).days;
        const cycleIndex = Math.floor(diffDays / CYCLE_LENGTH_DAYS);

        const cycleStartDate = anchorDate.add({
            days: cycleIndex * CYCLE_LENGTH_DAYS
        });
        const cycleEndDate = cycleStartDate.add({
            days: CYCLE_LENGTH_DAYS - CYCLE_END_DAY_OFFSET
        });

        const cycleKey = `${cycleStartDate.toString()} to ${cycleEndDate.toString()}`;

        if (!cycleMap.has(cycleKey)) {
            cycleMap.set(cycleKey, {
                cycleIndex,
                startDate: cycleStartDate.toString(),
                endDate: cycleEndDate.toString(),
                cycleKey,
                totalCount: 0,
                validCount: 0,
                tooEarlyCount: 0,
                thirtyMinCount: 0,
                baseCost: cycleCost,
                discount: 0,
                expectedPayment: cycleCost,
                records: []
            });
        }

        const cycle = cycleMap.get(cycleKey);
        cycle.totalCount += 1;
        if (day.isCounted) {
            cycle.validCount += 1;
        } else if (day.isTooEarly) {
            cycle.tooEarlyCount += 1;
        } else if (day.isThirtyMin) {
            cycle.thirtyMinCount += 1;
        }
        cycle.records.push(day);
    }

    const cycles = Array.from(cycleMap.values())
        .map((cycle) => {
            const discount = Number(
                Math.min(
                    cycle.baseCost,
                    cycle.validCount * discountPerVisit
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            );
            const expectedPayment = Number(
                Math.max(0, cycle.baseCost - discount).toFixed(
                    CURRENCY_DECIMAL_PLACES
                )
            );
            return {
                ...cycle,
                discount,
                expectedPayment,
                records: [...cycle.records].sort((a, b) =>
                    b.isoDate.localeCompare(a.isoDate)
                )
            };
        })
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

    return cycles;
}

export async function parsePdfBuffer(buffer, options = {}) {
    const minAttendanceMinutes =
        options.minAttendanceMinutes ?? SAFE_MIN_ATTENDANCE_MINUTES;
    const cycleCost = options.cycleCost ?? DEFAULT_CYCLE_COST;
    const anchorDate = options.anchorDate || DEFAULT_ANCHOR_DATE;
    const discountPerVisit =
        options.discountPerVisit ?? DEFAULT_DISCOUNT_PER_VISIT;
    const cycleLimit = options.cycleLimit ?? DEFAULT_CYCLE_LIMIT;

    const parser = new PDFParse({ data: buffer });
    const parsedTextResult = await parser.getText();
    const fullText = parsedTextResult.text || '';

    const rawRecords = extractRecordsFromText(
        fullText,
        minAttendanceMinutes,
        options
    );
    const dailyRecords = evaluateDailyAttendance(
        rawRecords,
        minAttendanceMinutes
    );
    const allCycles = groupIntoCycles(dailyRecords, {
        anchorDate,
        cycleCost,
        discountPerVisit
    });

    const cycles =
        cycleLimit && cycleLimit > 0
            ? allCycles.slice(0, cycleLimit)
            : allCycles;

    const totalCounted = cycles.reduce((sum, c) => sum + c.validCount, 0);
    const totalTooEarly = cycles.reduce((sum, c) => sum + c.tooEarlyCount, 0);
    const totalDiscount = cycles.reduce((sum, c) => sum + c.discount, 0);
    const totalCheckins = cycles.reduce((sum, c) => sum + c.totalCount, 0);

    const firstDate = cycles.length > 0 ? cycles.at(-1).startDate : null;
    const lastDate = cycles.length > 0 ? cycles[0].endDate : null;

    return {
        summary: {
            totalCheckins,
            totalCounted,
            totalTooEarly,
            totalCycles: cycles.length,
            allCyclesCount: allCycles.length,
            totalDiscount: Number(
                totalDiscount.toFixed(CURRENCY_DECIMAL_PLACES)
            ),
            cycleCost,
            minAttendanceMinutes,
            firstDate,
            lastDate,
            isLimitedToLast3: cycleLimit === DEFAULT_CYCLE_LIMIT
        },
        cycles,
        allCycles,
        dailyRecords,
        rawCount: rawRecords.length
    };
}

export {
    SAFE_ATTENDANCE_OFFSET,
    WEEKS_PER_CYCLE,
    DAYS_PER_WEEK,
    HOURS_PER_DAY
} from './config.js';
