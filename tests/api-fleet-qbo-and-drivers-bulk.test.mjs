import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountErpCoreApi } from '../routes/erp-core-api.mjs';

function makeDbMock() {
  const state = {
    mappings: new Map(),
    lastDriversBulk: null,
  };

  async function dbQuery(sql, params = []) {
    const q = String(sql || '').toLowerCase().replace(/\s+/g, ' ').trim();

    if (q.includes('create table if not exists fleet_asset_qbo_classes')) {
      return { rows: [], rowCount: 0 };
    }

    if (q.includes('select unit_number, qbo_class_id, qbo_class_name from fleet_asset_qbo_classes where unit_number = $1')) {
      const unit = String(params[0] || '').trim();
      const row = state.mappings.get(unit);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (q.includes('select unit_number, qbo_class_id, qbo_class_name from fleet_asset_qbo_classes')) {
      const rows = Array.from(state.mappings.values()).sort((a, b) => String(a.unit_number).localeCompare(String(b.unit_number)));
      return { rows, rowCount: rows.length };
    }

    if (q.includes('insert into fleet_asset_qbo_classes')) {
      const unit = String(params[0] || '').trim();
      const qbo_class_id = params[1] == null ? null : String(params[1]);
      const qbo_class_name = params[2] == null ? null : String(params[2]);
      state.mappings.set(unit, { unit_number: unit, qbo_class_id, qbo_class_name });
      return { rows: [], rowCount: 1 };
    }

    if (q.includes('update drivers set status = $2, updated_at = now() where unit_number = any($1::text[])')) {
      const ids = Array.isArray(params[0]) ? params[0].map(String) : [];
      const status = String(params[1] || '');
      state.lastDriversBulk = { ids, status };
      return { rows: [], rowCount: ids.length };
    }

    return { rows: [], rowCount: 0 };
  }

  return { state, dbQuery };
}

async function createTestServer({ withDb = true } = {}) {
  const app = express();
  app.use(express.json());
  const db = makeDbMock();
  mountErpCoreApi(app, {
    logError: () => {},
    getPool: withDb ? () => ({ ok: true }) : () => null,
    dbQuery: db.dbQuery,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { server, base, db };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('QBO class endpoints: happy path list/get/post', async () => {
  const { server, base } = await createTestServer({ withDb: true });
  try {
    const post = await fetch(base + '/api/fleet/assets/qbo-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_number: 'T120', qbo_class_id: '123', qbo_class_name: 'Truck 120' }),
    });
    assert.equal(post.status, 200);
    const postJson = await post.json();
    assert.equal(postJson.ok, true);

    const one = await fetch(base + '/api/fleet/assets/qbo-class?unit=T120');
    assert.equal(one.status, 200);
    const oneJson = await one.json();
    assert.equal(oneJson.ok, true);
    assert.equal(oneJson.class_name, 'Truck 120');

    const list = await fetch(base + '/api/fleet/assets/qbo-classes');
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.equal(listJson.ok, true);
    assert.equal(Array.isArray(listJson.mappings), true);
    assert.equal(listJson.mappings.length, 1);
  } finally {
    await closeServer(server);
  }
});

test('QBO class endpoints: error path missing unit and no db', async () => {
  const { server, base } = await createTestServer({ withDb: false });
  try {
    const postMissing = await fetch(base + '/api/fleet/assets/qbo-class', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qbo_class_name: 'x' }),
    });
    assert.equal(postMissing.status, 503);

    const getNoDb = await fetch(base + '/api/fleet/assets/qbo-class?unit=T120');
    assert.equal(getNoDb.status, 200);
    const getNoDbJson = await getNoDb.json();
    assert.equal(getNoDbJson.ok, true);
    assert.equal(getNoDbJson.class_name, '');
  } finally {
    await closeServer(server);
  }
});

test('Drivers bulk endpoint: happy path updates by unit_number strings', async () => {
  const { server, base, db } = await createTestServer({ withDb: true });
  try {
    const resp = await fetch(base + '/api/drivers/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['T120', 'T121'], status: 'active' }),
    });
    assert.equal(resp.status, 200);
    const json = await resp.json();
    assert.equal(json.ok, true);
    assert.equal(json.updated, 2);
    assert.deepEqual(db.state.lastDriversBulk, { ids: ['T120', 'T121'], status: 'active' });
  } finally {
    await closeServer(server);
  }
});

test('Drivers bulk endpoint: error paths invalid payload', async () => {
  const { server, base } = await createTestServer({ withDb: true });
  try {
    const noIds = await fetch(base + '/api/drivers/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(noIds.status, 400);

    const badStatus = await fetch(base + '/api/drivers/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['T120'], status: 'paused' }),
    });
    assert.equal(badStatus.status, 400);
  } finally {
    await closeServer(server);
  }
});
