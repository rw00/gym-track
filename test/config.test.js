import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDB, writeDB } from '../server.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, 'test-config-db.json');

describe('Cycle Anchor and Monthly Amount Config', () => {
    const originalAnchorDate = config.cycleAnchorDate;
    const originalCost = config.cycleCost;

    beforeEach(async () => {
        config.cycleAnchorDate = '2026-06-22';
        config.cycleCost = 60.8;
        await writeDB({ attendance: [], activeSession: null }, TEST_DB_PATH);
    });

    afterEach(async () => {
        config.cycleAnchorDate = originalAnchorDate;
        config.cycleCost = originalCost;
        try {
            await fs.unlink(TEST_DB_PATH);
        } catch {
            // Ignore if deleted
        }
    });

    test('readDB loads stored config from db.json and updates config object', async () => {
        await writeDB(
            {
                attendance: [],
                activeSession: null,
                config: {
                    cycleAnchorDate: '2026-01-15',
                    cycleCost: 75.5
                }
            },
            TEST_DB_PATH
        );

        const db = await readDB(TEST_DB_PATH);
        assert.equal(db.config.cycleAnchorDate, '2026-01-15');
        assert.equal(db.config.cycleCost, 75.5);
        assert.equal(config.cycleAnchorDate, '2026-01-15');
        assert.equal(config.cycleCost, 75.5);
    });

    test('updating config persists new cycleAnchorDate and cycleCost in db.json', async () => {
        const db = await readDB(TEST_DB_PATH);
        config.cycleAnchorDate = '2026-05-01';
        config.cycleCost = 80.0;
        db.config = {
            cycleAnchorDate: config.cycleAnchorDate,
            cycleCost: config.cycleCost
        };
        await writeDB(db, TEST_DB_PATH);

        // Reset memory config to check persistence reload
        config.cycleAnchorDate = '2026-01-01';
        config.cycleCost = 50.0;

        const reloadedDb = await readDB(TEST_DB_PATH);
        assert.equal(reloadedDb.config.cycleAnchorDate, '2026-05-01');
        assert.equal(reloadedDb.config.cycleCost, 80.0);
        assert.equal(config.cycleAnchorDate, '2026-05-01');
        assert.equal(config.cycleCost, 80.0);
    });
});
