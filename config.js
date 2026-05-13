import dotenv from 'dotenv';
dotenv.config();

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
export const DAYS_PER_YEAR = 365;

export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
export const MAX_UPLOAD_FILE_SIZE_MB = 25;
export const MAX_UPLOAD_FILE_SIZE_BYTES =
    MAX_UPLOAD_FILE_SIZE_MB * BYTES_PER_MB;

export const SESSION_COOKIE_MAX_AGE_MS = DAYS_PER_YEAR * MS_PER_DAY;

export const DEFAULT_PORT = 3000;
export const DEFAULT_TIMEZONE = 'Europe/Amsterdam';
export const DEFAULT_SESSION_SECRET = 'dev-secret';

export const MIN_ATTENDANCE_MINUTES = 30;
export const DEFAULT_MIN_ATTENDANCE_MINUTES = MIN_ATTENDANCE_MINUTES;
export const SAFE_ATTENDANCE_OFFSET = 1;
export const SAFE_MIN_ATTENDANCE_MINUTES =
    MIN_ATTENDANCE_MINUTES + SAFE_ATTENDANCE_OFFSET;
export const DIRECT_CHECKOUT_DURATION_MINUTES = 0;

export const WEEKS_PER_CYCLE = 4;
export const DAYS_PER_WEEK = 7;
export const CYCLE_LENGTH_DAYS = WEEKS_PER_CYCLE * DAYS_PER_WEEK;
export const CYCLE_END_DAY_OFFSET = 1;
export const DEFAULT_CYCLE_LIMIT = 3;
export const DEFAULT_CYCLE_COST = 60.8;
export const DEFAULT_CYCLE_BASE_AMOUNT = DEFAULT_CYCLE_COST;
export const DEFAULT_DISCOUNT_PER_VISIT = 1.0;
export const DEFAULT_CYCLE_ANCHOR_DATE = '2026-06-22';
export const CURRENCY_DECIMAL_PLACES = 2;

export const DEFAULT_SEED_START_DATE = '2026-05-27';
export const DEFAULT_SEED_END_DATE = '2026-06-05';
export const DEFAULT_SEED_DURATION_MINUTES = 60;

export const HTTP_STATUS = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    INTERNAL_SERVER_ERROR: 500
};

export const YEAR_STRING_LENGTH = 4;
export const DATE_PAD_LENGTH = 2;
export const JSON_INDENT_SPACES = 2;

export const config = {
    port: process.env.PORT || DEFAULT_PORT,
    timezone: process.env.TIMEZONE || DEFAULT_TIMEZONE,
    admin: {
        username: process.env.ADMIN_USER || 'admin',
        password: process.env.ADMIN_PASS || 'admin'
    },
    sessionSecret: process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
    cycleCost: Number.parseFloat(
        process.env.CYCLE_COST ||
            process.env.CYCLE_BASE_AMOUNT ||
            String(DEFAULT_CYCLE_COST)
    ),
    get cycleBaseAmount() {
        return this.cycleCost;
    },
    set cycleBaseAmount(val) {
        this.cycleCost = val;
    },
    cycleAnchorDate: process.env.CYCLE_ANCHOR_DATE || DEFAULT_CYCLE_ANCHOR_DATE,
    minAttendanceMinutes: Number.parseInt(
        process.env.MIN_ATTENDANCE_MINUTES ||
            String(DEFAULT_MIN_ATTENDANCE_MINUTES),
        10
    ),
    seedStartDate: process.env.SEED_START_DATE || DEFAULT_SEED_START_DATE,
    seedEndDate: process.env.SEED_END_DATE || DEFAULT_SEED_END_DATE
};
