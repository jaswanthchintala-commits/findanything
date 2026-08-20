try {
  const D = require('/home/ubuntu/findanything/node_modules/better-sqlite3');
  const db = new D(':memory:');
  db.exec('CREATE VIRTUAL TABLE t USING fts5(c)');
  db.prepare('INSERT INTO t(c) VALUES (?)').run('abi check');
  const r = db.prepare("SELECT rowid FROM t WHERE t MATCH 'abi'").get();
  console.log('ELECTRON_ABI_OK rowid=' + r.rowid);
  process.exit(0);
} catch (e) {
  console.log('ELECTRON_ABI_FAIL: ' + e.message);
  process.exit(1);
}
