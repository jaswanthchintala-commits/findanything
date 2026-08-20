'use strict';
const D = require('better-sqlite3');
const db = new D(':memory:');
db.exec(`
  CREATE TABLE files(id INTEGER PRIMARY KEY, path TEXT);
  CREATE VIRTUAL TABLE files_fts USING fts5(file_name, content, content='');
`);

db.prepare("INSERT INTO files_fts(rowid, file_name, content) VALUES (1, 'a.txt', 'hello world')").run();
db.prepare("INSERT INTO files_fts(rowid, file_name, content) VALUES (2, 'b.txt', 'goodbye mars')").run();
console.log('before delete:', JSON.stringify(db.prepare('SELECT rowid FROM files_fts WHERE files_fts MATCH ?').all('hello OR goodbye')));

// delete rowid 1 via command
db.prepare("INSERT INTO files_fts(files_fts, rowid) VALUES('delete', 1)").run();
console.log('after delete cmd:', JSON.stringify(db.prepare('SELECT rowid FROM files_fts WHERE files_fts MATCH ?').all('hello OR goodbye')));

// delete-all command
db.prepare("INSERT INTO files_fts(files_fts) VALUES('delete-all')").run();
console.log('after delete-all:', JSON.stringify(db.prepare('SELECT rowid FROM files_fts WHERE files_fts MATCH ?').all('hello OR goodbye')));

// re-insert after delete-all
db.prepare("INSERT INTO files_fts(rowid, file_name, content) VALUES (3, 'c.txt', 'hello again')").run();
console.log('after re-insert:', JSON.stringify(db.prepare('SELECT rowid FROM files_fts WHERE files_fts MATCH ?').all('hello')));

// snippet + bm25 with column weights
const s = db.prepare("SELECT snippet(files_fts, 1, '«', '»', ' … ', 10) snip, bm25(files_fts, 10.0, 1.0) r FROM files_fts WHERE files_fts MATCH 'hello'").all();
console.log('snippet/bm25:', JSON.stringify(s));
