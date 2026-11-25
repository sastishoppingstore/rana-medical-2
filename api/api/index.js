'use strict';
/* Rana Medical Hospital — demo API (Vercel serverless).
 * State is persisted in Supabase Postgres (table demo_state).
 * Sessions are stateless HMAC tokens (Authorization: Bearer) so the
 * frontend can live on Firebase Hosting while the API lives on Vercel.
 */
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { ROLES, POLICY, LABELS, FIELD_DEFS } = require('../lib/policies');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && /sslmode=(require|no-verify|prefer)/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
});

const SECRET = process.env.SESSION_SECRET || 'rana-demo-session-secret-change-me';
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://wafasmart.tech,https://www.wafasmart.tech')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* ---------- session tokens ---------- */
function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function createToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + 8 * 3600 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!ROLES.includes(data.role) || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { role: data.role };
  } catch { return null; }
}

/* ---------- helpers ---------- */
function cors(req, res) {
  const origin = req.headers.origin || '';
  const allow = ALLOWED.includes(origin) || /^https:\/\/([a-z0-9-]+\.)*(wafasmart\.tech|web\.app|firebaseapp\.com)$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', allow ? origin : ALLOWED[0] || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function json(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(obj));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=').map(decodeURIComponent)).filter((x) => x.length === 2));
}
function session(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return readToken(auth.slice(7));
  return readToken(parseCookies(req).rmh_demo);
}
function requireRole(req, res, allowed) {
  const s = session(req);
  if (!s) { json(res, 401, { error: 'Demo session required. Sign in from the Staff / ERP entry.' }); return null; }
  if (allowed && !allowed.includes(s.role)) { json(res, 403, { error: 'This demo role is not authorized for this action.' }); return null; }
  return s;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 20000) { reject(Error('Request body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { reject(Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}
function safeText(v, max = 120) {
  return typeof v === 'string' ? v.trim().replace(/[<>]/g, '').slice(0, max) : '';
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < new Date().toISOString().slice(0, 10)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
}

/* ---------- persistence ---------- */
async function readState() {
  const r = await pool.query('select data from demo_state where id = 1');
  if (!r.rows.length) throw Error('Demo state is not initialized.');
  return r.rows[0].data;
}
async function mutate(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query('select data from demo_state where id = 1 for update');
    if (!r.rows.length) throw Error('Demo state is not initialized.');
    const state = r.rows[0].data;
    const out = await fn(state);
    state.updatedAt = new Date().toISOString();
    await client.query('update demo_state set data = $1, updated_at = now() where id = 1', [state]);
    await client.query('commit');
    return out;
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
function audit(state, actor, action, detail = '') {
  state.audit = state.audit || [];
  state.audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, action, detail });
  state.audit = state.audit.slice(0, 500);
}
function makeRecord(state, resource, b, actor) {
  const fields = FIELD_DEFS[resource] || [];
  const out = {};
  for (const [key, label, type, required] of fields) {
    let val = b[key];
    if (required && (val === undefined || String(val).trim() === '')) throw Error(`${label} is required.`);
    if (val === undefined || val === null || val === '') continue;
    if (type === 'number') {
      val = Number(val);
      if (!Number.isFinite(val) || val < 0) throw Error(`${label} must be a non-negative number.`);
    } else if (Array.isArray(val)) val = val.map((x) => safeText(String(x), 150));
    else val = safeText(String(val), type === 'textarea' ? 2000 : 250);
    out[key] = val;
  }
  out.id = crypto.randomUUID();
  out.createdAt = new Date().toISOString();
  out.updatedAt = out.createdAt;
  out.createdBy = actor;
  out.sample = true;
  if (resource === 'labOrders' && out.patientPhone) {
    out.mobileHash = crypto.createHash('sha256').update(out.patientPhone.replace(/[\s-]/g, '')).digest('hex');
    delete out.patientPhone;
  }
  if (resource === 'invoices') out.invoiceNo = `INV-DEMO-${Date.now().toString().slice(-8)}`;
  if (resource === 'payments') out.receiptNo = `RCT-DEMO-${Date.now().toString().slice(-8)}`;
  return out;
}

/* ---------- handler ---------- */
module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && (p === '/api/health' || p === '/api')) {
      return json(res, 200, { ok: true, service: 'Rana Medical Hospital demo API', database: 'supabase-postgres', productionReady: false });
    }
    if (req.method === 'POST' && p === '/api/demo-session') {
      const body = await readBody(req);
      if (!ROLES.includes(body.role)) return json(res, 400, { error: 'Select a valid demo role.' });
      const token = createToken(body.role);
      await mutate((state) => { audit(state, body.role, 'demo_sign_in'); });
      return json(res, 200, { role: body.role, demo: true, token }, {
        'Set-Cookie': `rmh_demo=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=28800`,
      });
    }
    if (req.method === 'POST' && p === '/api/demo-role') {
      const s = requireRole(req, res, ROLES); if (!s) return;
      const body = await readBody(req);
      if (!ROLES.includes(body.role)) return json(res, 400, { error: 'Invalid demo role' });
      const token = createToken(body.role);
      await mutate((state) => { audit(state, body.role, 'demo_role_switch'); });
      return json(res, 200, { role: body.role, demo: true, token }, {
        'Set-Cookie': `rmh_demo=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=28800`,
      });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      const s = session(req);
      if (s) await mutate((state) => { audit(state, s.role, 'demo_sign_out'); });
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'rmh_demo=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0' });
    }

    if (req.method === 'GET' && p === '/api/public-content') {
      const state = await readState();
      return json(res, 200, {
        services: state.services.filter((x) => x.status === 'Published' && !x.deletedAt),
        packages: state.packages.filter((x) => x.status === 'Published' && !x.deletedAt),
        articles: state.blogPosts.filter((x) => x.status === 'Published' && !x.deletedAt),
        faqs: state.faqs.filter((x) => x.status === 'Published' && !x.deletedAt),
      });
    }
    if (req.method === 'GET' && p === '/api/doctors') {
      const state = await readState();
      return json(res, 200, { doctors: state.doctors.filter((d) => !d.deletedAt) });
    }
    if (req.method === 'POST' && p === '/api/doctors') {
      const s = requireRole(req, res, ['Super Admin']); if (!s) return;
      const b = await readBody(req);
      const doctor = {
        name: safeText(b.name, 100), specialty: safeText(b.specialty, 60), qual: safeText(b.qual, 120),
        experience: safeText(b.experience, 80), fee: Number(b.fee), days: safeText(b.days, 100),
        time: safeText(b.time, 80), emoji: '🩺', sample: true,
      };
      if (doctor.name.length < 3 || !doctor.specialty || !doctor.qual || !Number.isFinite(doctor.fee) || doctor.fee < 0) {
        return json(res, 400, { error: 'Provide a name, specialty, qualification label and valid fee.' });
      }
      const out = await mutate((state) => {
        if (state.doctors.some((d) => d.name.toLowerCase() === doctor.name.toLowerCase())) return { conflict: true };
        doctor.id = crypto.randomUUID();
        doctor.pmdc = 'Verification required';
        state.doctors.push(doctor);
        audit(state, s.role, 'demo_doctor_created', doctor.name);
        return { doctor };
      });
      if (out.conflict) return json(res, 409, { error: 'A doctor with this display name already exists.' });
      return json(res, 201, { doctor: out.doctor });
    }
    if (req.method === 'POST' && p === '/api/appointments') {
      const b = await readBody(req);
      const name = safeText(b.name, 100), phone = safeText(b.phone, 24), dept = safeText(b.department, 60);
      const doctor = safeText(b.doctor || 'Any available doctor', 100), date = safeText(b.date, 10), time = safeText(b.time, 24);
      const normalizedPhone = phone.replace(/[\s-]/g, '');
      if (name.length < 2 || !/^(?:\+92|0)3\d{9}$/.test(normalizedPhone) || !dept || !validDate(date) || !time) {
        return json(res, 400, { error: 'Check patient name, Pakistani mobile number, department, future date and time.' });
      }
      const out = await mutate((state) => {
        const d = crypto.randomBytes(3).toString('hex').toUpperCase();
        const token = `OPD-${String(state.appointments.length + 1).padStart(3, '0')}`;
        const appt = {
          reference: `RMH-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${d}`, token, name, phone,
          department: dept, doctor, date, time, status: 'Booked', createdAt: new Date().toISOString(), sample: true,
        };
        state.appointments.push(appt);
        audit(state, 'Public booking', 'appointment_created', appt.reference);
        return { appointment: appt };
      });
      return json(res, 201, { appointment: out.appointment });
    }
    if (req.method === 'GET' && p === '/api/appointments') {
      const s = requireRole(req, res, ['Super Admin', 'Receptionist', 'Doctor']); if (!s) return;
      const state = await readState();
      const items = s.role === 'Doctor'
        ? state.appointments.filter((a) => !a.doctor || a.doctor === 'Any available doctor')
        : state.appointments;
      return json(res, 200, { appointments: items, updatedAt: state.updatedAt });
    }

    const resourceMatch = p.match(/^\/api\/resources\/([a-zA-Z]+)(?:\/([a-zA-Z0-9-]+))?$/);
    if (resourceMatch) {
      const resource = resourceMatch[1], recordId = resourceMatch[2], policy = POLICY[resource];
      if (!policy) return json(res, 404, { error: 'Unknown resource' });
      const verb = req.method === 'GET' ? 'read' : 'write';
      const s = requireRole(req, res, policy[verb]); if (!s) return;

      if (req.method === 'GET') {
        const state = await readState();
        const rows = (state[resource] || []).filter((x) => !x.deletedAt).map((x) => {
          if (resource === 'labOrders') { const { mobileHash, ...safe } = x; return safe; }
          return x;
        });
        return json(res, 200, { resource, label: LABELS[resource], records: rows, fields: FIELD_DEFS[resource] || [] });
      }
      if (req.method === 'POST') {
        if (['appointments', 'admissions', 'labResults', 'labReports', 'pharmacySales', 'payments'].includes(resource)) {
          return json(res, 409, { error: 'Use the guarded workflow action for this resource.' });
        }
        const b = await readBody(req);
        const out = await mutate((state) => {
          const record = makeRecord(state, resource, b, s.role);
          if (resource === 'patients' && state.patients.some((x) => x.patientNo === record.patientNo)) return { conflict: 'Patient ID already exists.' };
          if (resource === 'employees' && state.employees.some((x) => x.employeeNo === record.employeeNo)) return { conflict: 'Employee ID already exists.' };
          state[resource].unshift(record);
          audit(state, s.role, `${resource}_created`, record.id);
          return { record };
        });
        if (out.conflict) return json(res, 409, { error: out.conflict });
        return json(res, 201, { record: out.record });
      }
      if (req.method === 'PATCH' && recordId) {
        const b = await readBody(req);
        const out = await mutate((state) => {
          const item = (state[resource] || []).find((x) => x.id === recordId && !x.deletedAt);
          if (!item) return { missing: true };
          const allowed = new Set((FIELD_DEFS[resource] || []).map((f) => f[0]));
          for (const [k, v] of Object.entries(b)) {
            if (!allowed.has(k)) continue;
            const clean = typeof v === 'string' ? safeText(v, 2000) : v;
            if (resource === 'labOrders' && k === 'patientPhone') {
              item.mobileHash = crypto.createHash('sha256').update(String(clean).replace(/[\s-]/g, '')).digest('hex');
            } else item[k] = clean;
            if (resource === 'appointments' && k === 'patientName') item.name = item[k];
          }
          item.updatedAt = new Date().toISOString();
          audit(state, s.role, `${resource}_updated`, recordId);
          return { record: item };
        });
        if (out.missing) return json(res, 404, { error: 'Record not found' });
        return json(res, 200, { record: out.record });
      }
      if (req.method === 'DELETE' && recordId) {
        const out = await mutate((state) => {
          const item = (state[resource] || []).find((x) => x.id === recordId && !x.deletedAt);
          if (!item) return { missing: true };
          item.deletedAt = new Date().toISOString();
          audit(state, s.role, `${resource}_archived`, recordId);
          return { ok: true };
        });
        if (out.missing) return json(res, 404, { error: 'Record not found' });
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    if (req.method === 'POST' && p === '/api/workflows/admit') {
      const s = requireRole(req, res, ['Super Admin', 'Doctor', 'Receptionist']); if (!s) return;
      const b = await readBody(req);
      const out = await mutate((state) => {
        const bed = state.beds.find((x) => (x.bedId === b.bedId || x.id === b.bedId) && x.status === 'Available');
        if (!bed) return { conflict: 'Selected bed is not available.' };
        const patientName = safeText(b.patientName, 100);
        if (patientName.length < 2) return { bad: 'Patient name is required.' };
        const rec = {
          id: crypto.randomUUID(), admissionNo: `IPD-${Date.now().toString().slice(-8)}`, patientName,
          patientId: safeText(b.patientId, 80), bedId: bed.bedId, ward: bed.ward,
          attendingDoctor: safeText(b.attendingDoctor, 100), admittedAt: new Date().toISOString(),
          status: 'Active', createdBy: s.role, sample: true,
        };
        bed.status = 'Occupied';
        bed.admissionId = rec.id;
        state.admissions.unshift(rec);
        audit(state, s.role, 'patient_admitted', rec.admissionNo);
        return { admission: rec, bed };
      });
      if (out.conflict) return json(res, 409, { error: out.conflict });
      if (out.bad) return json(res, 400, { error: out.bad });
      return json(res, 201, { admission: out.admission, bed: out.bed });
    }
    if (req.method === 'POST' && p === '/api/workflows/discharge') {
      const s = requireRole(req, res, ['Super Admin', 'Doctor', 'Receptionist', 'Accountant']); if (!s) return;
      const b = await readBody(req);
      const out = await mutate((state) => {
        const adm = state.admissions.find((x) => x.id === b.admissionId && x.status === 'Active');
        if (!adm) return { missing: true };
        adm.status = 'Discharged';
        adm.dischargedAt = new Date().toISOString();
        const bed = state.beds.find((x) => x.admissionId === adm.id);
        let total = 0;
        if (bed) {
          const days = Math.max(1, Math.ceil((Date.now() - new Date(adm.admittedAt).getTime()) / 86400000));
          total = days * Number(bed.dailyRate || 0);
          bed.status = 'Available';
          delete bed.admissionId;
        }
        const invoice = {
          id: crypto.randomUUID(), invoiceNo: `INV-IPD-${Date.now().toString().slice(-8)}`, patientName: adm.patientName,
          type: 'IPD', description: `IPD stay · ${adm.ward}`, total, status: 'Open', admissionId: adm.id,
          createdAt: new Date().toISOString(), sample: true,
        };
        state.invoices.unshift(invoice);
        audit(state, s.role, 'patient_discharged', adm.admissionNo);
        return { admission: adm, invoice };
      });
      if (out.missing) return json(res, 404, { error: 'Active admission not found' });
      return json(res, 200, { admission: out.admission, invoice: out.invoice });
    }
    if (req.method === 'POST' && p === '/api/workflows/pharmacy-sale') {
      const s = requireRole(req, res, ['Super Admin', 'Pharmacist']); if (!s) return;
      const b = await readBody(req);
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return json(res, 400, { error: 'Add at least one medicine line.' });
      const out = await mutate((state) => {
        const lines = [];
        let total = 0;
        for (const line of items) {
          const med = state.medicines.find((m) => m.id === line.medicineId || m.name === line.name);
          const qty = Number(line.quantity);
          if (!med || !Number.isInteger(qty) || qty < 1) return { bad: 'Invalid medicine or quantity.' };
          if (Number(med.stock) < qty) return { conflict: `Insufficient stock for ${med.name}.` };
          const unit = Number(med.salePrice) || 0;
          lines.push({ medicineId: med.id, name: med.name, quantity: qty, unitPrice: unit, amount: unit * qty });
          total += unit * qty;
        }
        for (const line of lines) {
          const med = state.medicines.find((m) => m.id === line.medicineId);
          med.stock = Number(med.stock) - line.quantity;
        }
        const sale = {
          id: crypto.randomUUID(), receiptNo: `RX-${Date.now().toString().slice(-8)}`,
          patientName: safeText(b.patientName || 'Walk-in', 100), items: lines, total, status: 'Paid',
          createdAt: new Date().toISOString(), createdBy: s.role, sample: true,
        };
        state.pharmacySales.unshift(sale);
        const invoice = {
          id: crypto.randomUUID(), invoiceNo: `INV-PH-${Date.now().toString().slice(-8)}`, patientName: sale.patientName,
          type: 'Pharmacy', description: 'Pharmacy POS sale', total, status: 'Paid', createdAt: new Date().toISOString(), sample: true,
        };
        state.invoices.unshift(invoice);
        state.payments.unshift({
          id: crypto.randomUUID(), receiptNo: `RCT-${Date.now().toString().slice(-8)}`, invoiceNo: invoice.invoiceNo,
          amount: total, method: safeText(b.method || 'Cash', 30), createdAt: new Date().toISOString(), sample: true,
        });
        audit(state, s.role, 'pharmacy_sale_posted', sale.receiptNo);
        return { sale, invoice };
      });
      if (out.bad) return json(res, 400, { error: out.bad });
      if (out.conflict) return json(res, 409, { error: out.conflict });
      return json(res, 201, { sale: out.sale, invoice: out.invoice });
    }
    if (req.method === 'POST' && p === '/api/workflows/payment') {
      const s = requireRole(req, res, ['Super Admin', 'Receptionist', 'Accountant']); if (!s) return;
      const b = await readBody(req);
      const out = await mutate((state) => {
        const invoice = state.invoices.find((x) => x.id === b.invoiceId || x.invoiceNo === b.invoiceNo);
        if (!invoice) return { missing: true };
        const amount = Number(b.amount);
        if (!Number.isFinite(amount) || amount <= 0) return { bad: 'Enter a positive payment amount.' };
        const paid = state.payments
          .filter((x) => x.invoiceNo === invoice.invoiceNo || x.invoiceId === invoice.id)
          .reduce((n, x) => n + Number(x.amount || 0), 0);
        if (amount > Number(invoice.total) - paid) return { conflict: 'Payment exceeds outstanding balance.' };
        const receipt = {
          id: crypto.randomUUID(), receiptNo: `RCT-${Date.now().toString().slice(-8)}`, invoiceNo: invoice.invoiceNo,
          invoiceId: invoice.id, amount, method: safeText(b.method || 'Cash', 30),
          createdAt: new Date().toISOString(), createdBy: s.role, sample: true,
        };
        state.payments.unshift(receipt);
        invoice.status = paid + amount >= Number(invoice.total) ? 'Paid' : 'Partially paid';
        audit(state, s.role, 'payment_recorded', receipt.receiptNo);
        return { receipt, invoice, outstanding: Number(invoice.total) - paid - amount };
      });
      if (out.missing) return json(res, 404, { error: 'Invoice not found.' });
      if (out.bad) return json(res, 400, { error: out.bad });
      if (out.conflict) return json(res, 409, { error: out.conflict });
      return json(res, 201, { receipt: out.receipt, invoice: out.invoice, outstanding: out.outstanding });
    }
    if (req.method === 'POST' && p === '/api/workflows/lab-result') {
      const s = requireRole(req, res, ['Super Admin', 'Lab Technician']); if (!s) return;
      const b = await readBody(req);
      const out = await mutate((state) => {
        const order = state.labOrders.find((x) => x.id === b.orderId);
        if (!order) return { missing: true };
        const result = {
          id: crypto.randomUUID(), orderId: order.id, test: order.test, result: safeText(b.result, 200),
          unit: safeText(b.unit, 40), referenceRange: safeText(b.referenceRange, 100),
          flag: safeText(b.flag || 'Unclassified', 30), status: 'Result entered',
          enteredBy: s.role, createdAt: new Date().toISOString(), sample: true,
        };
        state.labResults.unshift(result);
        order.status = 'Result entered';
        audit(state, s.role, 'lab_result_entered', order.id);
        return { result };
      });
      if (out.missing) return json(res, 404, { error: 'Lab order not found.' });
      return json(res, 201, { result: out.result });
    }
    if (req.method === 'POST' && p === '/api/workflows/lab-publish') {
      const s = requireRole(req, res, ['Super Admin', 'Lab Technician']); if (!s) return;
      const b = await readBody(req);
      const out = await mutate((state) => {
        const order = state.labOrders.find((x) => x.id === b.orderId);
        const result = state.labResults.find((x) => x.orderId === b.orderId);
        if (!order || !result) return { missing: true };
        if (b.confirmed !== true) return { bad: 'Authorized staff confirmation is required.' };
        order.status = 'Published';
        result.status = 'Published';
        const report = {
          id: crypto.randomUUID(), reportNo: `LAB-${Date.now().toString().slice(-8)}`, orderId: order.id,
          patientName: order.patientName, test: order.test, status: 'Published',
          publishedAt: new Date().toISOString(), publicRef: null, sample: true,
        };
        state.labReports.unshift(report);
        audit(state, s.role, 'lab_report_published', report.reportNo);
        return { report };
      });
      if (out.missing) return json(res, 404, { error: 'Order and entered result required before authorization.' });
      if (out.bad) return json(res, 400, { error: out.bad });
      return json(res, 201, { report: out.report });
    }

    if (req.method === 'GET' && (p === '/api/events' || p === '/api/public-events')) {
      /* Serverless-safe SSE stub: one event, then close. Clients poll for updates. */
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ event: 'connected' })}\n\n`);
      return res.end();
    }

    if (req.method === 'POST' && p === '/api/reports/verify') {
      const b = await readBody(req);
      const ref = safeText(b.reference, 60), phone = safeText(b.phone, 24);
      const normalized = phone.replace(/[\s-]/g, '');
      if (ref === 'RMH-DEMO-104' && ['03246627054', '+923246627054', '923246627054'].includes(normalized)) {
        return json(res, 200, {
          reference: 'RMH-DEMO-104', patient: 'Synthetic Demo Patient', test: 'Complete Blood Count · fictional data',
          date: '2026-10-15',
          results: [
            ['Haemoglobin', '13.2 g/dL', '12.0–16.0 g/dL', 'Within sample range'],
            ['WBC', '7.1 ×10⁹/L', '4.0–11.0 ×10⁹/L', 'Within sample range'],
            ['Platelets', '250 ×10⁹/L', '150–400 ×10⁹/L', 'Within sample range'],
          ],
          synthetic: true, notClinical: true,
        });
      }
      const state = await readState();
      const report = state.labReports.find((x) => x.reportNo === ref && x.status === 'Published');
      const order = report && state.labOrders.find((x) => x.id === report.orderId);
      const expected = order && order.mobileHash ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
      if (!report || !order || !expected || expected !== order.mobileHash) {
        return json(res, 404, { error: 'No published report matched these verification details.' });
      }
      const result = state.labResults.find((x) => x.orderId === order.id);
      if (!result) return json(res, 404, { error: 'No published report matched these verification details.' });
      return json(res, 200, {
        reference: report.reportNo, patient: order.patientName, test: order.test,
        date: String(report.publishedAt).slice(0, 10),
        results: [[order.test, result.result, result.referenceRange || 'See report', result.flag || 'Unclassified']],
        synthetic: true, notClinical: true,
      });
    }
    if (req.method === 'GET' && p === '/api/dashboard') {
      const s = requireRole(req, res, ROLES); if (!s) return;
      const state = await readState();
      const canSeeFinance = ['Super Admin', 'Accountant'].includes(s.role);
      const day = new Date().toISOString().slice(0, 10);
      const todayPay = state.payments.filter((x) => String(x.createdAt || '').slice(0, 10) === day);
      const cash = todayPay.filter((x) => (x.method || 'Cash').toLowerCase() === 'cash').reduce((n, x) => n + Number(x.amount || 0), 0);
      const online = todayPay.filter((x) => (x.method || 'Cash').toLowerCase() !== 'cash').reduce((n, x) => n + Number(x.amount || 0), 0);
      const income = state.payments.reduce((n, x) => n + Number(x.amount || 0), 0);
      const expenses = state.expenses.reduce((n, x) => n + Number(x.amount || 0), 0);
      return json(res, 200, {
        todayOpd: state.appointments.filter((x) => x.date === day).length,
        activeIpd: state.admissions.filter((x) => x.status === 'Active').length,
        cashRevenue: canSeeFinance ? cash : null,
        onlineRevenue: canSeeFinance ? online : null,
        pendingLab: state.labOrders.filter((x) => !['Published', 'Cancelled'].includes(x.status)).length,
        lowStock: state.medicines.filter((x) => Number(x.stock) <= Number(x.reorderLevel || 0)).length,
        todayExpenses: canSeeFinance ? state.expenses.filter((x) => String(x.date || x.createdAt || '').slice(0, 10) === day).reduce((n, x) => n + Number(x.amount || 0), 0) : null,
        netProfit: canSeeFinance ? income - expenses : null,
        totalIncome: canSeeFinance ? income : null,
        totalExpenses: canSeeFinance ? expenses : null,
        financeRestricted: !canSeeFinance,
        source: 'recorded demo transactions',
      });
    }
    if (req.method === 'GET' && p === '/api/audit') {
      const s = requireRole(req, res, ['Super Admin']); if (!s) return;
      const state = await readState();
      return json(res, 200, { logs: state.audit.slice(0, 100) });
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'API route not found' });
    return json(res, 200, { ok: true, service: 'Rana Medical Hospital demo API', docs: '/api/health' });
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message || 'Request failed' });
    else res.end();
  }
};
