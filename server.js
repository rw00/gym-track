import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Temporal } from 'temporal-polyfill';
import multer from 'multer';
import {
    config,
    DEFAULT_MIN_ATTENDANCE_MINUTES,
    SAFE_ATTENDANCE_OFFSET,
    DEFAULT_CYCLE_LIMIT,
    CYCLE_LENGTH_DAYS,
    CYCLE_END_DAY_OFFSET,
    DEFAULT_DISCOUNT_PER_VISIT,
    DEFAULT_SEED_DURATION_MINUTES,
    DIRECT_CHECKOUT_DURATION_MINUTES,
    MAX_UPLOAD_FILE_SIZE_BYTES,
    SESSION_COOKIE_MAX_AGE_MS,
    HTTP_STATUS,
    CURRENCY_DECIMAL_PLACES,
    YEAR_STRING_LENGTH,
    DATE_PAD_LENGTH,
    JSON_INDENT_SPACES
} from './config.js';
import { parsePdfBuffer } from './pdfParser.js';

const FileStore = sessionFileStore(session);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.json');
const SESSION_DIR = path.join(path.dirname(DB_PATH), 'sessions');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES }
});

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(
    session({
        store: new FileStore({ path: SESSION_DIR, retries: 0 }),
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: SESSION_COOKIE_MAX_AGE_MS,
            secure: false,
            sameSite: 'lax'
        }
    })
);

export function getCurrentYear(timezone = config.timezone) {
    return Temporal.Now.zonedDateTimeISO(timezone).year;
}

export function getYearDbPath(year, customDbPath = DB_PATH) {
    const dir = path.dirname(customDbPath);
    return path.join(dir, `${year}-db.json`);
}

export async function yearDbExists(year, customDbPath = DB_PATH) {
    try {
        await fs.access(getYearDbPath(year, customDbPath));
        return true;
    } catch {
        return false;
    }
}

export async function readDB(customDbPath = DB_PATH) {
    try {
        const data = await fs.readFile(customDbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading DB:', err);
        return { attendance: [], activeSession: null };
    }
}

export async function writeDB(data, customDbPath = DB_PATH) {
    await fs.writeFile(
        customDbPath,
        JSON.stringify(data, null, JSON_INDENT_SPACES)
    );
}

export async function ensurePartitionedByYear(
    customDbPath = DB_PATH,
    currentYear = getCurrentYear()
) {
    try {
        const db = await readDB(customDbPath);
        if (!Array.isArray(db.attendance) || db.attendance.length === 0) {
            return;
        }

        const currentYearRecords = [];
        const previousYearMap = new Map();

        for (const record of db.attendance) {
            if (!record?.date) continue;
            const year = Number.parseInt(
                record.date.slice(0, YEAR_STRING_LENGTH),
                10
            );
            if (year === currentYear) {
                currentYearRecords.push(record);
            } else if (year < currentYear) {
                if (!previousYearMap.has(year)) {
                    previousYearMap.set(year, []);
                }
                previousYearMap.get(year).push(record);
            }
        }

        if (previousYearMap.size > 0) {
            for (const [year, records] of previousYearMap.entries()) {
                const yearDbPath = getYearDbPath(year, customDbPath);
                let existingYearDb = { attendance: [] };
                try {
                    existingYearDb = JSON.parse(
                        await fs.readFile(yearDbPath, 'utf8')
                    );
                    if (!Array.isArray(existingYearDb.attendance)) {
                        existingYearDb.attendance = [];
                    }
                } catch {
                    // File doesn't exist yet
                }

                const existingDates = new Set(
                    existingYearDb.attendance.map((r) => r.date)
                );
                for (const rec of records) {
                    if (!existingDates.has(rec.date)) {
                        existingYearDb.attendance.push(rec);
                        existingDates.add(rec.date);
                    }
                }
                existingYearDb.attendance.sort((a, b) =>
                    a.date.localeCompare(b.date)
                );
                await fs.writeFile(
                    yearDbPath,
                    JSON.stringify(existingYearDb, null, JSON_INDENT_SPACES)
                );
            }

            db.attendance = currentYearRecords.toSorted((a, b) =>
                a.date.localeCompare(b.date)
            );
            await writeDB(db, customDbPath);
        }
    } catch (err) {
        console.error('Error in ensurePartitionedByYear:', err);
    }
}

export async function syncAttendanceRecords(
    dailyRecords,
    customDbPath = DB_PATH,
    currentYear = getCurrentYear()
) {
    if (!Array.isArray(dailyRecords) || dailyRecords.length === 0) {
        return { updated: false, addedOrUpdatedCount: 0, totalAttendance: 0 };
    }

    const currentYearDaily = [];
    const previousYearsDaily = new Map();

    for (const day of dailyRecords) {
        if (!day.isCounted || !day.isoDate || !day.startTime) continue;
        const year = Number.parseInt(
            day.isoDate.slice(0, YEAR_STRING_LENGTH),
            10
        );
        if (year === currentYear) {
            currentYearDaily.push(day);
        } else if (year < currentYear) {
            if (!previousYearsDaily.has(year)) {
                previousYearsDaily.set(year, []);
            }
            previousYearsDaily.get(year).push(day);
        }
    }

    for (const [year, records] of previousYearsDaily.entries()) {
        const yearDbFile = getYearDbPath(year, customDbPath);
        let exists = false;
        try {
            await fs.access(yearDbFile);
            exists = true;
        } catch {
            exists = false;
        }

        if (!exists) {
            const yearAttendance = records
                .map((day) => {
                    const [startH, startM] = day.startTime
                        .split(':')
                        .map(Number);
                    const timePart = `${String(startH).padStart(DATE_PAD_LENGTH, '0')}:${String(startM).padStart(DATE_PAD_LENGTH, '0')}:00`;
                    const startZonedDateTime = Temporal.ZonedDateTime.from(
                        `${day.isoDate}T${timePart}[${config.timezone}]`
                    );
                    const endZonedDateTime = startZonedDateTime.add({
                        minutes: day.durationMinutes
                    });
                    return {
                        date: day.isoDate,
                        startTime: startZonedDateTime.toInstant().toString(),
                        endTime: endZonedDateTime.toInstant().toString(),
                        durationMinutes: day.durationMinutes,
                        method: 'standard'
                    };
                })
                .sort((a, b) => a.date.localeCompare(b.date));

            await fs.writeFile(
                yearDbFile,
                JSON.stringify(
                    { attendance: yearAttendance },
                    null,
                    JSON_INDENT_SPACES
                )
            );
        }
    }

    const db = await readDB(customDbPath);
    if (!Array.isArray(db.attendance)) {
        db.attendance = [];
    }

    const existingMap = new Map();
    for (const record of db.attendance) {
        if (record?.date) {
            const y = Number.parseInt(
                record.date.slice(0, YEAR_STRING_LENGTH),
                10
            );
            if (y === currentYear) {
                existingMap.set(record.date, record);
            }
        }
    }

    let addedOrUpdatedCount = 0;

    for (const day of currentYearDaily) {
        const [startH, startM] = day.startTime.split(':').map(Number);
        const timePart = `${String(startH).padStart(DATE_PAD_LENGTH, '0')}:${String(startM).padStart(DATE_PAD_LENGTH, '0')}:00`;
        const startZonedDateTime = Temporal.ZonedDateTime.from(
            `${day.isoDate}T${timePart}[${config.timezone}]`
        );
        const endZonedDateTime = startZonedDateTime.add({
            minutes: day.durationMinutes
        });

        const newRecord = {
            date: day.isoDate,
            startTime: startZonedDateTime.toInstant().toString(),
            endTime: endZonedDateTime.toInstant().toString(),
            durationMinutes: day.durationMinutes,
            method: 'standard'
        };

        existingMap.set(day.isoDate, newRecord);
        addedOrUpdatedCount++;
    }

    db.attendance = Array.from(existingMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
    );

    await writeDB(db, customDbPath);

    return {
        updated: true,
        addedOrUpdatedCount,
        totalAttendance: db.attendance.length
    };
}

function parseDateConfig(dateStr) {
    if (!dateStr) return null;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

async function seedDB() {
    try {
        const db = await readDB();
        if (db.attendance?.length === 0) {
            const parsedStart = parseDateConfig(config.seedStartDate);
            const parsedEnd = parseDateConfig(config.seedEndDate);
            if (!parsedStart || !parsedEnd) return;

            const startDate = Temporal.PlainDate.from(parsedStart);
            const endDate = Temporal.PlainDate.from(parsedEnd);

            let currentDate = startDate;
            while (Temporal.PlainDate.compare(currentDate, endDate) <= 0) {
                const dateStr = currentDate.toString();
                const startZonedDateTime = Temporal.ZonedDateTime.from(
                    `${dateStr}T09:00:00[${config.timezone}]`
                );
                const endZonedDateTime = startZonedDateTime.add({
                    minutes: DEFAULT_SEED_DURATION_MINUTES
                });

                db.attendance.push({
                    date: dateStr,
                    startTime: startZonedDateTime.toInstant().toString(),
                    endTime: endZonedDateTime.toInstant().toString(),
                    durationMinutes: DEFAULT_SEED_DURATION_MINUTES,
                    method: 'standard'
                });
                currentDate = currentDate.add({ days: 1 });
            }
            await writeDB(db);
            console.log(
                `Successfully seeded check-ins from ${parsedStart} to ${parsedEnd}.`
            );
        }
    } catch (err) {
        console.error('Failed to seed check-ins:', err);
    }
}

function isAuthenticated(req, res, next) {
    if (!req.session) {
        return res
            .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
            .json({ error: 'Session configuration error' });
    }
    if (req.session.user) {
        next();
    } else {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
    }
}

app.post('/api/parse-pdf', upload.single('pdf'), async (req, res, next) => {
    try {
        if (!req.file?.buffer) {
            return res
                .status(HTTP_STATUS.BAD_REQUEST)
                .json({ error: 'No PDF file uploaded' });
        }
        const cycleLimit = req.query.all === 'true' ? 0 : DEFAULT_CYCLE_LIMIT;
        const dbDir = path.dirname(DB_PATH);
        const currentYear = getCurrentYear();
        const report = await parsePdfBuffer(req.file.buffer, {
            cycleCost: config.cycleCost,
            minAttendanceMinutes:
                (config.minAttendanceMinutes ||
                    DEFAULT_MIN_ATTENDANCE_MINUTES) + SAFE_ATTENDANCE_OFFSET,
            anchorDate: config.cycleAnchorDate,
            cycleLimit,
            dbDir,
            currentYear
        });

        const syncResult = await syncAttendanceRecords(report.dailyRecords);
        report.syncResult = syncResult;

        res.json(report);
    } catch (err) {
        console.error('Error processing PDF:', err);
        next(err);
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (
        username === config.admin.username &&
        password === config.admin.password
    ) {
        req.session.user = { username };
        res.json({ success: true });
    } else {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
            error: 'Invalid credentials'
        });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/status', isAuthenticated, async (req, res) => {
    const db = await readDB();
    const now = Temporal.Now.zonedDateTimeISO(config.timezone);
    const strToday = now.toPlainDate().toString();

    const attendedToday = db.attendance.some(
        (entry) => entry.date === strToday
    );

    res.json({
        activeSession: db.activeSession,
        attendedToday,
        minAttendanceMinutes: config.minAttendanceMinutes
    });
});

app.post('/api/checkin', isAuthenticated, async (req, res) => {
    const db = await readDB();
    const now = Temporal.Now.zonedDateTimeISO(config.timezone);
    const strToday = now.toPlainDate().toString();

    if (db.activeSession) {
        return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json({ error: 'Already checked in' });
    }

    if (db.attendance.some((entry) => entry.date === strToday)) {
        return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json({ error: 'Already attended today' });
    }

    db.activeSession = {
        startTime: now.toInstant().toString(),
        date: strToday
    };

    await writeDB(db);
    res.json({ success: true, activeSession: db.activeSession });
});

app.post('/api/checkout', isAuthenticated, async (req, res) => {
    try {
        const db = await readDB();

        const now = Temporal.Now.zonedDateTimeISO(config.timezone);
        const strToday = now.toPlainDate().toString();

        if (db.activeSession) {
            const startTime = Temporal.Instant.from(
                db.activeSession.startTime
            ).toZonedDateTimeISO(config.timezone);
            const duration = now.since(startTime);
            const minutes = Math.floor(duration.total({ unit: 'minutes' }));

            if (
                minutes >=
                (config.minAttendanceMinutes ||
                    DEFAULT_MIN_ATTENDANCE_MINUTES) +
                    SAFE_ATTENDANCE_OFFSET
            ) {
                db.attendance.push({
                    date: db.activeSession.date,
                    startTime: db.activeSession.startTime,
                    endTime: now.toInstant().toString(),
                    durationMinutes: minutes,
                    method: 'standard'
                });
                db.activeSession = null;
                await writeDB(db);
                res.json({ success: true, message: 'Attendance recorded' });
            } else {
                db.activeSession = null;
                await writeDB(db);
                res.json({
                    success: true,
                    message: 'Session too short; discarded'
                });
            }
        } else {
            if (db.attendance.some((entry) => entry.date === strToday)) {
                return res
                    .status(HTTP_STATUS.BAD_REQUEST)
                    .json({ error: 'Already attended today' });
            }

            db.attendance.push({
                date: strToday,
                startTime: now.toInstant().toString(),
                endTime: now.toInstant().toString(),
                durationMinutes: DIRECT_CHECKOUT_DURATION_MINUTES,
                method: 'direct-checkout'
            });
            await writeDB(db);
            res.json({ success: true, message: 'Direct checkout recorded' });
        }
    } catch (err) {
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
            error: 'Internal server error',
            details: err.message,
            stack:
                process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

app.get('/api/history', isAuthenticated, async (req, res) => {
    const db = await readDB();

    const cycleStats = {};
    const anchorDate = Temporal.PlainDate.from(config.cycleAnchorDate);

    db.attendance.forEach((entry) => {
        const date = Temporal.PlainDate.from(entry.date);
        const diff = date.since(anchorDate, { largestUnit: 'days' }).days;

        const cycleIndex = Math.floor(diff / CYCLE_LENGTH_DAYS);
        const cycleStartDate = anchorDate.add({
            days: cycleIndex * CYCLE_LENGTH_DAYS
        });
        const cycleEndDate = cycleStartDate.add({
            days: CYCLE_LENGTH_DAYS - CYCLE_END_DAY_OFFSET
        });

        const cycleKey = `${cycleStartDate.toString()} to ${cycleEndDate.toString()}`;

        if (!cycleStats[cycleKey]) {
            cycleStats[cycleKey] = {
                month: cycleKey,
                cycleStart: cycleStartDate.toString(),
                cycleEnd: cycleEndDate.toString(),
                attendedDays: 0,
                records: []
            };
        }
        cycleStats[cycleKey].attendedDays += 1;
        cycleStats[cycleKey].records.push(entry);
    });

    const history = Object.values(cycleStats)
        .map((stat) => ({
            ...stat,
            records: stat.records.sort((a, b) =>
                b.startTime.localeCompare(a.startTime)
            ),
            expectedPayment: Number(
                Math.max(
                    0,
                    config.cycleCost -
                        stat.attendedDays * DEFAULT_DISCOUNT_PER_VISIT
                ).toFixed(CURRENCY_DECIMAL_PLACES)
            )
        }))
        .sort((a, b) => b.cycleStart.localeCompare(a.cycleStart));

    res.json(history);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: 'Internal server error',
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

(async () => {
    await ensurePartitionedByYear();
    await seedDB();
})();

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
    app.listen(config.port, () => {
        console.log(`Server started on port ${config.port}`);
    });
}

export { app, DB_PATH, seedDB };
