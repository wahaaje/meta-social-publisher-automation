const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('checked-in sample rows are inert and contain no remote state', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'templates', 'publishing-queue.csv'), 'utf8');
  const rows = parseCsv(file);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].length, 17);
  for (const data of rows.slice(1)) {
    assert.equal(data.length, 17);
    assert.equal(data[4], 'DRAFT');
    assert.equal(data[5], 'PENDING');
    assert.equal(data[6], 'PENDING');
    for (const index of [7, 8, 9, 12, 13]) assert.equal(data[index], '');
  }
});
