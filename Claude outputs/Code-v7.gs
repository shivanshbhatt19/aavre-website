/**
 * Aavre Ops Console : gatekeeper (Google Apps Script web app)
 *
 * The only thing allowed to read or write the Aavre_Ops Sheets.
 * Deploy as: Web app, Execute as "Me" (the Aavre Google account), Who has access "Anyone".
 * Every call except login needs a valid session token.
 *
 * First time: run setup() once from the editor, then read the Execution log
 * for the two Sheet links and the super admin's temporary password.
 */

const CFG = {
  TZ: 'Asia/Kolkata',
  IDLE_MS: 2 * 60 * 60 * 1000,      // session expires after 2 hours of inactivity
  TOUCH_MS: 60 * 1000,              // only rewrite "last seen" once a minute
  LOCK_AFTER: 5,                    // wrong passwords before lockout
  LOCK_MS: 15 * 60 * 1000,          // lockout length
  HASH_ROUNDS: 1000,
  MIN_PASSWORD: 10,
  MAX_KM: 800,                      // largest odometer jump allowed in one record
  SUPER_ADMIN: 'shivansh'
};

const AUDIT = [
  ['createdBy', 'Created by'], ['createdAt', 'Created at'],
  ['updatedBy', 'Updated by'], ['updatedAt', 'Updated at'],
  ['deleted', 'Deleted']
];

const SCHEMA = {
  cars: { tab: 'Cars', admin: true, natural: true, cols: [
    ['id', 'Registration no'], ['nickname', 'Nickname'], ['model', 'Model'], ['status', 'Status']] },
  drivers: { tab: 'Drivers', admin: true, natural: true, cols: [
    ['id', 'Mobile'], ['name', 'Name'], ['type', 'Type'], ['defaultPay', 'Default pay (Rs)'],
    ['payBasis', 'Pay basis'], ['upi', 'UPI ID'], ['bankAccount', 'Bank account'], ['ifsc', 'IFSC'],
    ['status', 'Status']] },
  trips: { tab: 'Trips', cols: [
    ['id', 'Trip ID'], ['date', 'Date'], ['startTime', 'Start time'], ['car', 'Car'],
    ['driver', 'Driver mobile'], ['driverName', 'Driver name'], ['tripType', 'Trip type'],
    ['source', 'Booking source'], ['partner', 'Partner name'], ['bookingRef', 'Booking ref'],
    ['customerName', 'Customer name'], ['customerMobile', 'Customer mobile'],
    ['from', 'From'], ['to', 'To'], ['odoStart', 'Odometer start'], ['odoEnd', 'Odometer end'], ['km', 'KM'],
    ['fare', 'Fare (Rs)'], ['paymentMode', 'Payment mode'], ['received', 'Amount received (Rs)'], ['due', 'Amount due (Rs)'],
    ['toll', 'Toll (Rs)'], ['parking', 'Parking (Rs)'], ['stateTax', 'State/permit tax (Rs)'],
    ['fastCharging', 'Fast charging (Rs)'], ['driverFood', 'Driver food/allowance (Rs)'],
    ['otherExp', 'Other trip expense (Rs)'], ['otherExpNote', 'Other expense note'],
    ['driverPay', 'Driver pay (Rs)'], ['tripCosts', 'Trip costs total (Rs)'], ['tripProfit', 'Trip profit (Rs)'],
    ['odoNote', 'Odometer note'], ['notes', 'Notes'],
    ['socStart', 'Starting charging %'], ['socEnd', 'End charging %'], ['chargingStops', 'Public charging stops'],
    ['commission', 'Commission (Rs)'], ['commissionTo', 'Commission to'], ['commissionDriver', 'Commission driver mobile'],
    ['commissionDriverName', 'Commission driver name'], ['commissionName', 'Commission person name'],
    ['commissionMobile', 'Commission person mobile'], ['commissionPayout', 'Commission paid']] },
  charging: { tab: 'Charging stops', internal: true, cols: [
    ['id', 'Stop ID'], ['tripId', 'Trip ID'], ['date', 'Date'], ['car', 'Car'], ['station', 'Charging station'],
    ['cpo', 'CPO'], ['socStart', 'Start charging %'], ['socEnd', 'End charging %'], ['units', 'Units consumed (kWh)'],
    ['amount', 'Amount (Rs)']] },
  platform: { tab: 'Platform income', cols: [
    ['id', 'Entry ID'], ['date', 'Date'], ['car', 'Car'], ['driver', 'Driver mobile'], ['driverName', 'Driver name'],
    ['platform', 'Platform'], ['rides', 'Rides'], ['earnings', 'Earnings (Rs)'],
    ['cashCollected', 'Cash collected by driver (Rs)'], ['odoStart', 'Odometer start'], ['odoEnd', 'Odometer end'],
    ['km', 'KM'], ['toll', 'Toll (Rs)'], ['parking', 'Parking (Rs)'], ['odoNote', 'Odometer note'], ['notes', 'Notes'],
    ['socStart', 'Starting charging %'], ['socEnd', 'End charging %'],
    ['ridesRapido', 'Rides Rapido'], ['ridesUber', 'Rides Uber'], ['onlineCollected', 'Online collected by driver (Rs)'],
    ['driverExpense', 'Driver expense (Rs)'], ['driverExpenseNote', 'Driver expense note'],
    ['appCollected', 'Paid in app, platform pays Aavre (Rs)']] },
  expenses: { tab: 'Expenses', cols: [
    ['id', 'Expense ID'], ['date', 'Date paid'], ['group', 'Category group'], ['category', 'Category'],
    ['car', 'Car'], ['driver', 'Driver mobile'], ['driverName', 'Driver name'], ['amount', 'Amount (Rs)'],
    ['paidVia', 'Paid via'], ['note', 'Vendor / note']] },
  settlements: { tab: 'Settlements', cols: [
    ['id', 'Settlement ID'], ['date', 'Date'], ['type', 'Type'], ['driver', 'Driver mobile'], ['driverName', 'Driver name'],
    ['platform', 'Platform'], ['amount', 'Amount (Rs)'], ['collectedBy', 'Collected by'],
    ['tripId', 'Linked trip ID'], ['notes', 'Notes']] },
  categories: { tab: 'Categories', admin: true, natural: true, cols: [
    ['id', 'Category'], ['group', 'Group'], ['hidden', 'Hidden']] }
};

const AUTH_SCHEMA = {
  users: { tab: 'Users', cols: [
    ['username', 'Username'], ['name', 'Name'], ['role', 'Role'], ['salt', 'Salt'], ['hash', 'Password hash'],
    ['status', 'Status'], ['mustChange', 'Must change password'], ['failed', 'Failed attempts'],
    ['lockedUntil', 'Locked until'], ['createdAt', 'Created at'], ['updatedAt', 'Updated at']] },
  sessions: { tab: 'Sessions', cols: [
    ['tokenHash', 'Token hash'], ['username', 'Username'], ['createdAt', 'Created at'], ['lastSeen', 'Last seen']] }
};

const LISTS = {
  carStatus: ['Active', 'Inactive'],
  driverType: ['Permanent', 'On call'],
  payBasis: ['Per month', 'Per day', 'Per trip'],
  tripType: ['Airport transfer', 'Day hire', 'Custom route', 'Other'],
  source: ['WhatsApp', 'Phone', 'Hotel or homestay partner', 'Walk in', 'Other'],
  paymentMode: ['Cash to driver', 'UPI to company', 'UPI to driver'],
  platform: ['Uber', 'Rapido'],
  paidVia: ['Company UPI or bank', 'Company cash', 'Driver from collected cash'],
  settlementType: ['Driver cash handover', 'Driver UPI handover', 'Platform payout received', 'Customer due collected'],
  collectedBy: ['Company', 'Driver'],
  groups: ['Trip costs', 'Driver', 'Car fixed', 'Other'],
  commissionTo: ['Our driver', 'Others']
};

const DEFAULT_CATEGORIES = [
  ['Toll', 'Trip costs'], ['Parking', 'Trip costs'], ['State tax', 'Trip costs'], ['Charging', 'Trip costs'],
  ['Salary', 'Driver'], ['On call pay', 'Driver'], ['Allowance or food', 'Driver'], ['Advance', 'Driver'],
  ['Insurance', 'Car fixed'], ['Permit, fitness or tax', 'Car fixed'], ['GPS or VLTD', 'Car fixed'],
  ['Maintenance or repair', 'Other'], ['Cleaning', 'Other'], ['In car amenities', 'Other'],
  ['Platform fees', 'Other'], ['Marketing', 'Other'], ['Other', 'Other']
];

const DATE_KEYS = { date: true };
const TEXT_KEYS = { startTime: true, bankAccount: true, customerMobile: true, commissionMobile: true }; // stored as plain text so Sheets does not reformat them
const TIME_KEYS = { startTime: true };
const NUM_KEYS = {
  odoStart: 1, odoEnd: 1, km: 1, fare: 1, received: 1, due: 1, toll: 1, parking: 1, stateTax: 1,
  fastCharging: 1, driverFood: 1, otherExp: 1, driverPay: 1, tripCosts: 1, tripProfit: 1,
  rides: 1, earnings: 1, cashCollected: 1, amount: 1, defaultPay: 1, socStart: 1, socEnd: 1, units: 1, chargingStops: 1,
  ridesRapido: 1, ridesUber: 1, onlineCollected: 1, driverExpense: 1, appCollected: 1, commission: 1
};

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */

function doGet() {
  return ContentService.createTextOutput('Aavre Ops API').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = { ok: true, data: route_(body) };
  } catch (err) {
    out = { ok: false, error: err.userMessage || 'Something went wrong. Try again.', code: err.code || 'ERROR' };
    if (err.extra) out.extra = err.extra;
    if (!err.userMessage) console.error(err && err.stack ? err.stack : err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(body) {
  const action = String(body.action || '');
  if (action === 'login') return login_(body.username, body.password);

  const sess = authenticate_(body.token);
  const user = sess.user;
  const open = { logout: 1, me: 1, changePassword: 1 };
  if (publicUser_(user).mustChange && !open[action]) fail_('Set a new password to continue.', 'MUST_CHANGE');

  switch (action) {
    case 'me': return publicUser_(user);
    case 'logout': deleteSession_(sess.tokenHash); return true;
    case 'changePassword': return changePassword_(user, sess.tokenHash, body.oldPassword, body.newPassword);
    case 'getAll': return getAll_();
    case 'save': return save_(user, body.table, body.record || {}, !!body.isNew, body.odoConfirmed);
    case 'remove': return remove_(user, body.table, body.id);
    case 'listUsers': requireAdmin_(user); return listUsers_();
    case 'addUser': requireAdmin_(user); return addUser_(body.username, body.name, body.tempPassword);
    case 'resetPassword': requireAdmin_(user); return resetPassword_(body.username, body.tempPassword);
    case 'setUserStatus': requireAdmin_(user); return setUserStatus_(user, body.username, body.status);
    case 'signOutAll': requireAdmin_(user); return signOutAll_();
    default: fail_('Unknown action.', 'BAD_ACTION');
  }
}

/* ------------------------------------------------------------------ */
/* Errors and small helpers                                            */
/* ------------------------------------------------------------------ */

function fail_(msg, code, extra) {
  const e = new Error(msg);
  e.userMessage = msg; e.code = code || 'INVALID'; if (extra) e.extra = extra;
  throw e;
}

function props_() { return PropertiesService.getScriptProperties(); }

function dataSs_() {
  const id = props_().getProperty('DATA_SHEET_ID');
  if (!id) fail_('Setup has not been run yet.', 'NO_SETUP');
  return SpreadsheetApp.openById(id);
}

function authSs_() {
  const id = props_().getProperty('AUTH_SHEET_ID');
  if (!id) fail_('Setup has not been run yet.', 'NO_SETUP');
  return SpreadsheetApp.openById(id);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function num_(v, label, opts) {
  opts = opts || {};
  if (v === '' || v === null || v === undefined) {
    if (opts.required) fail_(label + ' is required.');
    return '';
  }
  const n = Number(v);
  if (!isFinite(n)) fail_(label + ' must be a number.');
  if (n < 0) fail_(label + ' cannot be negative.');
  if (opts.positive && n <= 0) fail_(label + ' must be more than zero.');
  return Math.round(n * 100) / 100;
}

function oneOf_(v, list, label, required) {
  v = str_(v);
  if (!v) { if (required !== false) fail_(label + ' is required.'); return ''; }
  if (list.indexOf(v) < 0) fail_(label + ' is not a valid choice.');
  return v;
}

function isoDay_(v, label) {
  v = str_(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail_(label + ' is required (YYYY-MM-DD).');
  return v;
}

function fmtCell_(key, v) {
  if (v instanceof Date) {
    if (DATE_KEYS[key]) return Utilities.formatDate(v, CFG.TZ, 'yyyy-MM-dd');
    if (TIME_KEYS[key]) return Utilities.formatDate(v, CFG.TZ, 'HH:mm');
    return v.toISOString();
  }
  if (NUM_KEYS[key]) return v === '' ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v);
}

/* ------------------------------------------------------------------ */
/* Table access (rows mapped by header name, so column order can move) */
/* ------------------------------------------------------------------ */

function table_(ss, schema) {
  const sh = ss.getSheetByName(schema.tab);
  if (!sh) fail_('Sheet tab "' + schema.tab + '" is missing. Run setup again.', 'NO_SETUP');
  const all = schema.cols.concat(schema._audit || []);
  const values = sh.getDataRange().getValues();
  const header = values[0] || [];
  const colIndex = {};
  all.forEach(function (c) { colIndex[c[0]] = header.indexOf(c[1]); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(function (x) { return x === '' || x === null; })) continue;
    const o = { _row: i + 1 };
    all.forEach(function (c) { const ix = colIndex[c[0]]; o[c[0]] = ix < 0 ? '' : fmtCell_(c[0], r[ix]); });
    rows.push(o);
  }
  return { sheet: sh, header: header, cols: all, colIndex: colIndex, rows: rows };
}

function writeRow_(t, obj, rowNumber) {
  const width = t.header.length;
  const line = new Array(width);
  // keep existing cells for columns we do not manage
  if (rowNumber) {
    const cur = t.sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    for (let i = 0; i < width; i++) line[i] = cur[i];
  } else {
    for (let i = 0; i < width; i++) line[i] = '';
  }
  t.cols.forEach(function (c) {
    const ix = t.colIndex[c[0]];
    if (ix >= 0 && obj[c[0]] !== undefined) {
      const v = obj[c[0]];
      line[ix] = TEXT_KEYS[c[0]] && v !== '' ? "'" + v : v;
    }
  });
  if (rowNumber) t.sheet.getRange(rowNumber, 1, 1, width).setValues([line]);
  else t.sheet.appendRow(line);
}

function dataSchema_(name) {
  const s = SCHEMA[name];
  if (!s) fail_('Unknown table.', 'BAD_TABLE');
  s._audit = AUDIT;
  return s;
}

function authSchema_(name) {
  const s = AUTH_SCHEMA[name];
  s._audit = [];
  return s;
}

function clean_(row) {
  const o = {};
  Object.keys(row).forEach(function (k) { if (k !== '_row') o[k] = row[k]; });
  return o;
}

/* ------------------------------------------------------------------ */
/* Passwords and sessions                                              */
/* ------------------------------------------------------------------ */

function b64_(bytes) { return Utilities.base64Encode(bytes); }

function sha_(s) { return b64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }

function hashPassword_(password, salt) {
  let h = salt + '|' + password;
  for (let i = 0; i < CFG.HASH_ROUNDS; i++) h = sha_(h + '|' + salt);
  return h;
}

function newSecret_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function checkNewPassword_(p) {
  p = String(p || '');
  if (p.length < CFG.MIN_PASSWORD) fail_('Password must be at least ' + CFG.MIN_PASSWORD + ' characters.', 'WEAK_PASSWORD');
  return p;
}

function users_() { return table_(authSs_(), authSchema_('users')); }
function sessions_() { return table_(authSs_(), authSchema_('sessions')); }

function findUser_(t, username) {
  const u = str_(username).toLowerCase();
  for (let i = 0; i < t.rows.length; i++) if (String(t.rows[i].username).toLowerCase() === u) return t.rows[i];
  return null;
}

function publicUser_(u) {
  return { username: u.username, name: u.name, role: u.role, mustChange: u.mustChange === 'Yes' || u.mustChange === true };
}

function login_(username, password) {
  return withLock_(function () {
    const t = users_();
    const u = findUser_(t, username);
    const now = Date.now();
    if (!u || u.status !== 'Active') fail_('Wrong username or password.', 'BAD_LOGIN');
    const lockedUntil = u.lockedUntil ? new Date(u.lockedUntil).getTime() : 0;
    if (lockedUntil > now) {
      fail_('Too many wrong attempts. Try again in ' + Math.ceil((lockedUntil - now) / 60000) + ' minutes.', 'LOCKED');
    }
    if (hashPassword_(String(password || ''), u.salt) !== u.hash) {
      let failed = Number(u.failed || 0) + 1;
      const patch = { failed: failed, updatedAt: new Date() };
      if (failed >= CFG.LOCK_AFTER) { patch.failed = 0; patch.lockedUntil = new Date(now + CFG.LOCK_MS); }
      writeRow_(t, patch, u._row);
      if (patch.lockedUntil) fail_('Too many wrong attempts. Try again in 15 minutes.', 'LOCKED');
      fail_('Wrong username or password.', 'BAD_LOGIN');
    }
    writeRow_(t, { failed: 0, lockedUntil: '', updatedAt: new Date() }, u._row);
    const token = newSecret_();
    const st = sessions_();
    writeRow_(st, { tokenHash: sha_(token), username: u.username, createdAt: new Date(), lastSeen: new Date() });
    return { token: token, user: publicUser_(u) };
  });
}

function authenticate_(token) {
  if (!token) fail_('Please log in.', 'AUTH');
  const tokenHash = sha_(String(token));
  const st = sessions_();
  let s = null;
  for (let i = 0; i < st.rows.length; i++) if (st.rows[i].tokenHash === tokenHash) { s = st.rows[i]; break; }
  if (!s) fail_('Session ended. Please log in again.', 'AUTH');
  const last = new Date(s.lastSeen).getTime();
  const now = Date.now();
  if (!(last > 0) || now - last > CFG.IDLE_MS) {
    st.sheet.deleteRow(s._row);
    fail_('Logged out after 2 hours of inactivity. Please log in again.', 'AUTH');
  }
  const u = findUser_(users_(), s.username);
  if (!u || u.status !== 'Active') { st.sheet.deleteRow(s._row); fail_('Account disabled.', 'AUTH'); }
  if (now - last > CFG.TOUCH_MS) writeRow_(st, { lastSeen: new Date() }, s._row);
  return { user: u, tokenHash: tokenHash };
}

function deleteSession_(tokenHash) {
  withLock_(function () {
    const st = sessions_();
    for (let i = st.rows.length - 1; i >= 0; i--) if (st.rows[i].tokenHash === tokenHash) st.sheet.deleteRow(st.rows[i]._row);
  });
}

function deleteUserSessions_(username, exceptHash) {
  const st = sessions_();
  const u = String(username).toLowerCase();
  for (let i = st.rows.length - 1; i >= 0; i--) {
    const r = st.rows[i];
    if (String(r.username).toLowerCase() === u && r.tokenHash !== exceptHash) st.sheet.deleteRow(r._row);
  }
}

function changePassword_(user, tokenHash, oldPassword, newPassword) {
  return withLock_(function () {
    const t = users_();
    const u = findUser_(t, user.username);
    if (hashPassword_(String(oldPassword || ''), u.salt) !== u.hash) fail_('Current password is wrong.', 'BAD_LOGIN');
    const p = checkNewPassword_(newPassword);
    if (p === String(oldPassword)) fail_('New password must be different.', 'WEAK_PASSWORD');
    const salt = newSecret_();
    writeRow_(t, { salt: salt, hash: hashPassword_(p, salt), mustChange: 'No', updatedAt: new Date() }, u._row);
    deleteUserSessions_(u.username, tokenHash);
    u.mustChange = 'No';
    return publicUser_(u);
  });
}

function requireAdmin_(user) {
  if (user.role !== 'Super admin') fail_('Only the super admin can do this.', 'FORBIDDEN');
}

function listUsers_() {
  return users_().rows.map(function (u) {
    const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
    return { username: u.username, name: u.name, role: u.role, status: u.status, mustChange: u.mustChange === 'Yes', locked: !!locked };
  });
}

function addUser_(username, name, tempPassword) {
  username = str_(username).toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) fail_('Username: 3 to 30 letters, numbers, dots or underscores.');
  if (!str_(name)) fail_('Name is required.');
  const p = checkNewPassword_(tempPassword);
  return withLock_(function () {
    const t = users_();
    if (findUser_(t, username)) fail_('That username already exists.', 'DUPLICATE');
    const salt = newSecret_();
    writeRow_(t, { username: username, name: str_(name), role: 'User', salt: salt, hash: hashPassword_(p, salt),
      status: 'Active', mustChange: 'Yes', failed: 0, lockedUntil: '', createdAt: new Date(), updatedAt: new Date() });
    return listUsers_();
  });
}

function resetPassword_(username, tempPassword) {
  const p = checkNewPassword_(tempPassword);
  return withLock_(function () {
    const t = users_();
    const u = findUser_(t, username);
    if (!u) fail_('User not found.');
    const salt = newSecret_();
    writeRow_(t, { salt: salt, hash: hashPassword_(p, salt), mustChange: 'Yes', failed: 0, lockedUntil: '', updatedAt: new Date() }, u._row);
    deleteUserSessions_(u.username, null);
    return listUsers_();
  });
}

function setUserStatus_(admin, username, status) {
  status = oneOf_(status, ['Active', 'Disabled'], 'Status');
  return withLock_(function () {
    const t = users_();
    const u = findUser_(t, username);
    if (!u) fail_('User not found.');
    if (String(u.username).toLowerCase() === String(admin.username).toLowerCase()) fail_('You cannot disable your own account.');
    writeRow_(t, { status: status, updatedAt: new Date() }, u._row);
    if (status === 'Disabled') deleteUserSessions_(u.username, null);
    return listUsers_();
  });
}

function signOutAll_() {
  return withLock_(function () {
    const st = sessions_();
    const n = st.sheet.getLastRow();
    if (n > 1) st.sheet.deleteRows(2, n - 1);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function getAll_() {
  const ss = dataSs_();
  const out = {};
  Object.keys(SCHEMA).forEach(function (name) {
    out[name] = table_(ss, dataSchema_(name)).rows
      .filter(function (r) { return r.deleted !== 'Yes'; })
      .map(clean_);
  });
  out.lists = LISTS;
  out.maxKm = CFG.MAX_KM;
  out.sheetUrl = ss.getUrl();
  return out;
}

function odoOverlap_(ss, car, start, end, excludeId) {
  let hit = null;
  ['trips', 'platform'].forEach(function (name) {
    table_(ss, dataSchema_(name)).rows.forEach(function (r) {
      if (hit || r.deleted === 'Yes' || r.car !== car || r.id === excludeId) return;
      const a = Number(r.odoStart), b = Number(r.odoEnd);
      if (r.odoStart === '' || r.odoEnd === '' || !isFinite(a) || !isFinite(b)) return;
      if (start < b && end > a) hit = { start: a, end: b, date: r.date };
    });
  });
  return hit;
}

function checkOdo_(ss, rec, excludeId, confirmed, unchanged) {
  rec.odoStart = num_(rec.odoStart, 'Odometer start', { required: true });
  rec.odoEnd = num_(rec.odoEnd, 'Odometer end', { required: true });
  if (rec.odoEnd <= rec.odoStart) fail_('Odometer end must be more than odometer start.');
  rec.km = Math.round((rec.odoEnd - rec.odoStart) * 10) / 10;
  if (rec.km > CFG.MAX_KM) fail_('That is ' + rec.km + ' km in one record, over the ' + CFG.MAX_KM + ' km limit. Check the readings.');
  rec.odoNote = str_(rec.odoNote);
  if (unchanged) return;
  const hit = odoOverlap_(ss, rec.car, rec.odoStart, rec.odoEnd, excludeId);
  if (hit && (!confirmed || !rec.odoNote)) {
    fail_('These readings overlap another entry for this car (' + hit.start + ' to ' + hit.end + ' on ' + hit.date +
      '). Check the odometer, or add a reason to save anyway.', 'ODO_WARN', hit);
  }
}

function soc_(v, label) {
  const x = num_(v, label, { required: true });
  if (x > 100) fail_(label + ' must be between 0 and 100.');
  return x;
}

function validateStops_(list, trip) {
  if (!Array.isArray(list)) list = [];
  return list.map(function (r, i) {
    const n = 'Charging stop ' + (i + 1) + ': ';
    const st = {};
    st.id = trip.id + '-C' + (i + 1);
    st.tripId = trip.id; st.date = trip.date; st.car = trip.car;
    st.station = str_(r.station); if (!st.station) fail_(n + 'charging station name is required.');
    st.cpo = str_(r.cpo); if (!st.cpo) fail_(n + 'CPO is required.');
    st.socStart = soc_(r.socStart, n + 'start charging %');
    st.socEnd = soc_(r.socEnd, n + 'end charging %');
    if (st.socEnd <= st.socStart) fail_(n + 'end charging % must be more than start charging %.');
    st.units = num_(r.units, n + 'units consumed', { required: true, positive: true });
    st.amount = num_(r.amount, n + 'amount', { required: true });
    return st;
  });
}

function writeStops_(ss, user, tripId, stops) {
  const t = table_(ss, dataSchema_('charging'));
  const now = new Date();
  t.rows.forEach(function (r) {
    if (r.tripId === tripId && r.deleted !== 'Yes') writeRow_(t, { deleted: 'Yes', updatedBy: user.username, updatedAt: now }, r._row);
  });
  stops.forEach(function (st) {
    const row = Object.assign({}, st, { createdBy: user.username, createdAt: now, updatedBy: '', updatedAt: '', deleted: 'No' });
    writeRow_(t, row);
  });
}

function unchangedOdo_(ss, table, rec, isNew) {
  if (isNew) return false;
  const cur = lookup_(ss, table, rec.id);
  return !!cur && cur.car === rec.car && Number(cur.odoStart) === Number(rec.odoStart) && Number(cur.odoEnd) === Number(rec.odoEnd);
}

function lookup_(ss, name, id) {
  const rows = table_(ss, dataSchema_(name)).rows;
  for (let i = 0; i < rows.length; i++) if (String(rows[i].id) === String(id) && rows[i].deleted !== 'Yes') return rows[i];
  return null;
}

function requireCar_(ss, v) {
  v = str_(v);
  if (!v) fail_('Car is required.');
  if (!lookup_(ss, 'cars', v)) fail_('Unknown car.');
  return v;
}

function requireDriver_(ss, v) {
  v = str_(v);
  if (!v) fail_('Driver is required.');
  const d = lookup_(ss, 'drivers', v);
  if (!d) fail_('Unknown driver.');
  return d;
}

function validate_(ss, table, r, isNew, confirmed) {
  const rec = {};
  rec.id = str_(r.id);
  if (!rec.id) fail_('Missing record ID.');

  switch (table) {
    case 'cars':
      rec.id = rec.id.toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{6,12}$/.test(rec.id)) fail_('Registration no should look like RJ27AB1234.');
      rec.nickname = str_(r.nickname);
      rec.model = str_(r.model);
      if (!rec.model) fail_('Model is required.');
      rec.status = oneOf_(r.status || 'Active', LISTS.carStatus, 'Status');
      break;

    case 'drivers':
      rec.id = rec.id.replace(/\D/g, '');
      if (!/^\d{10}$/.test(rec.id)) fail_('Driver mobile must be 10 digits.');
      rec.name = str_(r.name);
      if (!rec.name) fail_('Driver name is required.');
      rec.type = oneOf_(r.type, LISTS.driverType, 'Type');
      rec.defaultPay = num_(r.defaultPay, 'Default pay');
      rec.payBasis = oneOf_(r.payBasis, LISTS.payBasis, 'Pay basis', rec.defaultPay !== '');
      rec.upi = str_(r.upi);
      rec.bankAccount = str_(r.bankAccount).replace(/\s/g, '');
      rec.ifsc = str_(r.ifsc).toUpperCase();
      rec.status = oneOf_(r.status || 'Active', LISTS.carStatus, 'Status');
      break;

    case 'categories':
      rec.group = oneOf_(r.group, LISTS.groups, 'Group');
      rec.hidden = r.hidden === 'Yes' || r.hidden === true ? 'Yes' : 'No';
      break;

    case 'trips': {
      rec.date = isoDay_(r.date, 'Date');
      rec.startTime = str_(r.startTime);
      if (rec.startTime && !/^\d{2}:\d{2}$/.test(rec.startTime)) fail_('Start time must be HH:MM.');
      rec.car = requireCar_(ss, r.car);
      const d = requireDriver_(ss, r.driver);
      rec.driver = d.id; rec.driverName = d.name;
      rec.tripType = oneOf_(r.tripType, LISTS.tripType, 'Trip type');
      rec.source = oneOf_(r.source, LISTS.source, 'Booking source');
      rec.partner = str_(r.partner);
      if (rec.source === 'Hotel or homestay partner' && !rec.partner) fail_('Partner name is required for partner bookings.');
      rec.bookingRef = str_(r.bookingRef);
      rec.customerName = str_(r.customerName);
      rec.customerMobile = str_(r.customerMobile);
      rec.from = str_(r.from); rec.to = str_(r.to);
      if (!rec.from || !rec.to) fail_('From and To are required.');
      rec.odoNote = r.odoNote; rec.odoStart = r.odoStart; rec.odoEnd = r.odoEnd;
      checkOdo_(ss, rec, isNew ? null : rec.id, confirmed, unchangedOdo_(ss, table, rec, isNew));
      rec.socStart = soc_(r.socStart, 'Starting charging %');
      rec.socEnd = soc_(r.socEnd, 'End charging %');
      rec._stops = validateStops_(r.chargingStops, rec);
      rec.chargingStops = rec._stops.length;
      rec.fare = num_(r.fare, 'Fare', { required: true });
      rec.paymentMode = oneOf_(r.paymentMode, LISTS.paymentMode, 'Payment mode');
      rec.received = num_(r.received, 'Amount received', { required: true });
      rec.due = Math.max(0, Math.round((rec.fare - rec.received) * 100) / 100);
      const costLabels = { toll: 'Toll', parking: 'Parking', stateTax: 'State or permit tax', fastCharging: 'Fast charging',
        driverFood: 'Driver food or allowance', otherExp: 'Other trip expense', driverPay: 'Driver pay' };
      Object.keys(costLabels).forEach(function (k) { if (k !== 'fastCharging') rec[k] = num_(r[k], costLabels[k]) || 0; });
      rec.fastCharging = rec._stops.reduce(function (a, st) { return a + st.amount; }, 0); // total of the charging stops
      rec.otherExpNote = str_(r.otherExpNote);
      // commission: to one of our drivers (permanent: paid with salary, on call: paid at trip end) or to someone else
      rec.commission = num_(r.commission, 'Commission') || 0;
      rec.commissionTo = ''; rec.commissionDriver = ''; rec.commissionDriverName = ''; rec.commissionName = ''; rec.commissionMobile = ''; rec.commissionPayout = '';
      if (rec.commission > 0) {
        rec.commissionTo = oneOf_(r.commissionTo, LISTS.commissionTo, 'Commission to');
        if (rec.commissionTo === 'Our driver') {
          const cd = requireDriver_(ss, r.commissionDriver);
          rec.commissionDriver = cd.id; rec.commissionDriverName = cd.name;
          rec.commissionPayout = cd.type === 'Permanent' ? 'With salary' : 'At end of trip';
        } else {
          rec.commissionName = str_(r.commissionName);
          if (!rec.commissionName) fail_('Name of the person getting the commission is required.');
          rec.commissionMobile = str_(r.commissionMobile).replace(/\D/g, '');
          if (!/^\d{10}$/.test(rec.commissionMobile)) fail_('Mobile of the person getting the commission must be 10 digits.');
          rec.commissionPayout = 'Paid to other';
        }
      }
      if (rec.otherExp > 0 && !rec.otherExpNote) fail_('Add a note for the other trip expense.');
      rec.tripCosts = rec.toll + rec.parking + rec.stateTax + rec.fastCharging + rec.driverFood + rec.otherExp + rec.driverPay + rec.commission;
      rec.tripProfit = Math.round((rec.fare - rec.tripCosts) * 100) / 100;
      rec.notes = str_(r.notes);
      break;
    }

    case 'platform': {
      rec.date = isoDay_(r.date, 'Date');
      rec.car = requireCar_(ss, r.car);
      const d = requireDriver_(ss, r.driver);
      rec.driver = d.id; rec.driverName = d.name;
      // one row per car per day; the driver runs Uber and Rapido together
      rec.platform = 'Uber + Rapido';
      rec.ridesRapido = num_(r.ridesRapido, 'No of rides Rapido', { required: true });
      rec.ridesUber = num_(r.ridesUber, 'No of rides Uber', { required: true });
      rec.rides = rec.ridesRapido + rec.ridesUber;
      if (rec.rides <= 0) fail_('Enter at least one ride.');
      // cash rides: the driver collects in hard cash or UPI; in app rides: the platform pays Aavre directly
      rec.cashCollected = num_(r.cashCollected, 'Hard cash collected by driver', { required: true });
      rec.onlineCollected = num_(r.onlineCollected, 'UPI collected by driver', { required: true });
      rec.appCollected = num_(r.appCollected, 'Paid in app', { required: true });
      rec.earnings = Math.round((rec.cashCollected + rec.onlineCollected + rec.appCollected) * 100) / 100;
      rec.driverExpense = num_(r.driverExpense, 'Driver expense') || 0;
      rec.driverExpenseNote = str_(r.driverExpenseNote);
      if (rec.driverExpense > 0 && !rec.driverExpenseNote) fail_('Add a note for the driver expense (for example puncture or parking).');
      rec.odoNote = r.odoNote; rec.odoStart = r.odoStart; rec.odoEnd = r.odoEnd;
      checkOdo_(ss, rec, isNew ? null : rec.id, confirmed, unchangedOdo_(ss, table, rec, isNew));
      rec.socStart = soc_(r.socStart, 'Starting charging %');
      rec.socEnd = soc_(r.socEnd, 'End charging %');
      rec.toll = num_(r.toll, 'Toll') || 0;
      rec.parking = num_(r.parking, 'Parking') || 0;
      rec.notes = str_(r.notes);
      break;
    }

    case 'expenses': {
      rec.date = isoDay_(r.date, 'Date paid');
      const cat = lookup_(ss, 'categories', str_(r.category));
      if (!cat) fail_('Pick a category.');
      rec.category = cat.id; rec.group = cat.group;
      rec.car = str_(r.car) || 'General';
      if (rec.category === 'Charging') rec.car = 'General'; // decided: charging is not assigned to a car in v1
      if (rec.car !== 'General') requireCar_(ss, rec.car);
      if (rec.group === 'Driver') {
        const d = requireDriver_(ss, r.driver);
        rec.driver = d.id; rec.driverName = d.name;
      } else if (str_(r.driver)) {
        const d = requireDriver_(ss, r.driver);
        rec.driver = d.id; rec.driverName = d.name;
      } else { rec.driver = ''; rec.driverName = ''; }
      rec.amount = num_(r.amount, 'Amount', { required: true, positive: true });
      rec.paidVia = oneOf_(r.paidVia, LISTS.paidVia, 'Paid via');
      if (rec.paidVia === 'Driver from collected cash' && !rec.driver) fail_('Pick the driver whose cash paid for this.');
      rec.note = str_(r.note);
      break;
    }

    case 'settlements': {
      rec.date = isoDay_(r.date, 'Date');
      rec.type = oneOf_(r.type, LISTS.settlementType, 'Type');
      rec.amount = num_(r.amount, 'Amount', { required: true, positive: true });
      rec.platform = ''; rec.driver = ''; rec.driverName = ''; rec.collectedBy = ''; rec.tripId = '';
      if (rec.type === 'Platform payout received') {
        rec.platform = oneOf_(r.platform, LISTS.platform, 'Platform');
      } else if (rec.type === 'Customer due collected') {
        rec.tripId = str_(r.tripId);
        if (!rec.tripId || !lookup_(ss, 'trips', rec.tripId)) fail_('Pick the trip this payment is for.');
        rec.collectedBy = oneOf_(r.collectedBy, LISTS.collectedBy, 'Collected by');
        if (rec.collectedBy === 'Driver') { const d = requireDriver_(ss, r.driver); rec.driver = d.id; rec.driverName = d.name; }
      } else {
        const d = requireDriver_(ss, r.driver);
        rec.driver = d.id; rec.driverName = d.name;
      }
      rec.notes = str_(r.notes);
      break;
    }

    default:
      fail_('Unknown table.', 'BAD_TABLE');
  }
  return rec;
}

function save_(user, table, record, isNew, odoConfirmed) {
  const schema = dataSchema_(table);
  if (schema.internal) fail_('Unknown table.', 'BAD_TABLE');
  if (schema.admin) requireAdmin_(user);
  const ss = dataSs_();
  return withLock_(function () {
    const t = table_(ss, schema);
    const findRow = function (id) {
      for (let i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === String(id)) return t.rows[i];
      return null;
    };
    // same entry sent twice (retry after a network drop): keep one copy
    if (isNew && !schema.natural) {
      const dup = findRow(str_(record.id));
      if (dup && dup.deleted !== 'Yes') {
        const d = clean_(dup);
        if (table === 'trips') d.stops = stopsFor_(ss, d.id);
        return d;
      }
    }
    const rec = validate_(ss, table, record, isNew, odoConfirmed);
    const existing = findRow(rec.id);
    const now = new Date();

    if (isNew) {
      if (existing) {
        if (schema.natural) {
          if (existing.deleted === 'Yes') { /* re-adding a deleted item: revive it below */ }
          else fail_(table === 'drivers' ? 'A driver with this mobile already exists.' : 'This already exists.', 'DUPLICATE');
        } else {
          fail_('This entry ID is already used. Refresh and try again.', 'DUPLICATE');
        }
      }
    } else if (!existing || existing.deleted === 'Yes') {
      fail_('This record no longer exists.', 'NOT_FOUND');
    }

    if (existing) {
      rec.updatedBy = user.username; rec.updatedAt = now; rec.deleted = 'No';
      writeRow_(t, rec, existing._row);
    } else {
      rec.createdBy = user.username; rec.createdAt = now; rec.updatedBy = ''; rec.updatedAt = ''; rec.deleted = 'No';
      writeRow_(t, rec);
    }
    if (table === 'trips') {
      const stops = rec._stops; delete rec._stops;
      writeStops_(ss, user, rec.id, stops);
      rec.stops = stops;
    }
    return rec;
  });
}

function stopsFor_(ss, tripId) {
  return table_(ss, dataSchema_('charging')).rows
    .filter(function (r) { return r.tripId === tripId && r.deleted !== 'Yes'; }).map(clean_);
}

function remove_(user, table, id) {
  const schema = dataSchema_(table);
  if (schema.internal) fail_('Unknown table.', 'BAD_TABLE');
  if (schema.admin) requireAdmin_(user);
  if (table === 'categories') fail_('Categories cannot be deleted. Hide them instead.');
  if (table === 'cars' || table === 'drivers') fail_('Mark it Inactive instead of deleting.');
  const ss = dataSs_();
  return withLock_(function () {
    const t = table_(ss, schema);
    for (let i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i].id) === String(id) && t.rows[i].deleted !== 'Yes') {
        writeRow_(t, { deleted: 'Yes', updatedBy: user.username, updatedAt: new Date() }, t.rows[i]._row);
        if (table === 'trips') writeStops_(ss, user, String(id), []);
        return true;
      }
    }
    fail_('This record no longer exists.', 'NOT_FOUND');
  });
}

/* ------------------------------------------------------------------ */
/* One time setup and recovery (run from the Apps Script editor)       */
/* ------------------------------------------------------------------ */

function ensureTabs_(ss, schemas, withAudit) {
  Object.keys(schemas).forEach(function (k) {
    const s = schemas[k];
    let sh = ss.getSheetByName(s.tab);
    if (!sh) sh = ss.insertSheet(s.tab);
    const headers = s.cols.concat(withAudit ? AUDIT : []).map(function (c) { return c[1]; });
    const cur = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    headers.forEach(function (h) { if (cur.indexOf(h) < 0) cur.push(h); });
    const clean = cur.filter(function (h) { return h !== ''; });
    sh.getRange(1, 1, 1, clean.length).setValues([clean]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
}

function setup() {
  const p = props_();
  let dataId = p.getProperty('DATA_SHEET_ID');
  let authId = p.getProperty('AUTH_SHEET_ID');
  const data = dataId ? SpreadsheetApp.openById(dataId) : SpreadsheetApp.create('Aavre_Ops');
  const auth = authId ? SpreadsheetApp.openById(authId) : SpreadsheetApp.create('Aavre_Ops_Auth (owner only)');
  p.setProperty('DATA_SHEET_ID', data.getId());
  p.setProperty('AUTH_SHEET_ID', auth.getId());
  data.setSpreadsheetTimeZone(CFG.TZ);
  auth.setSpreadsheetTimeZone(CFG.TZ);

  ensureTabs_(data, SCHEMA, true);
  ensureTabs_(auth, AUTH_SCHEMA, false);

  const cats = table_(data, dataSchema_('categories'));
  if (cats.rows.length === 0) {
    DEFAULT_CATEGORIES.forEach(function (c) {
      writeRow_(cats, { id: c[0], group: c[1], hidden: 'No', createdBy: 'setup', createdAt: new Date(), deleted: 'No' });
    });
  }

  const ut = users_();
  let tempPassword = null;
  if (!findUser_(ut, CFG.SUPER_ADMIN)) {
    tempPassword = newSecret_().slice(0, 14);
    const salt = newSecret_();
    writeRow_(ut, { username: CFG.SUPER_ADMIN, name: 'Shivansh', role: 'Super admin', salt: salt,
      hash: hashPassword_(tempPassword, salt), status: 'Active', mustChange: 'Yes', failed: 0, lockedUntil: '',
      createdAt: new Date(), updatedAt: new Date() });
  }

  console.log('Data Sheet (share with named team emails only): ' + data.getUrl());
  console.log('Auth Sheet (share with NO ONE): ' + auth.getUrl());
  if (tempPassword) console.log('Super admin username: ' + CFG.SUPER_ADMIN + '   temporary password: ' + tempPassword);
  else console.log('Super admin already exists. To reset its password run resetSuperAdmin().');
}

/** Recovery: if the super admin password is lost or locked, run this from the editor. */
function resetSuperAdmin() {
  const t = users_();
  const u = findUser_(t, CFG.SUPER_ADMIN);
  if (!u) { setup(); return; }
  const tempPassword = newSecret_().slice(0, 14);
  const salt = newSecret_();
  writeRow_(t, { salt: salt, hash: hashPassword_(tempPassword, salt), status: 'Active', mustChange: 'Yes',
    failed: 0, lockedUntil: '', updatedAt: new Date() }, u._row);
  deleteUserSessions_(u.username, null);
  console.log('Super admin username: ' + CFG.SUPER_ADMIN + '   temporary password: ' + tempPassword);
}

/** Housekeeping: deletes expired sessions. Optional daily time trigger. */
function cleanSessions() {
  withLock_(function () {
    const st = sessions_();
    const now = Date.now();
    for (let i = st.rows.length - 1; i >= 0; i--) {
      if (now - new Date(st.rows[i].lastSeen).getTime() > CFG.IDLE_MS) st.sheet.deleteRow(st.rows[i]._row);
    }
  });
}
