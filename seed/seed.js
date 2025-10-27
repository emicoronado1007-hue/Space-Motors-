import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'data.db'));
db.exec('DELETE FROM images; DELETE FROM cars; VACUUM;');

const insert = db.prepare('INSERT INTO cars (title,price,year,mileage,city,description) VALUES (?,?,?,?,?,?)');
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]/g,'-') + '-' + Date.now();

insert.run('Mazda 3 i Touring', 158000, 2017, 78500, 'Ciudad de Mexico', 'Único dueño');
console.log('Seed listo con DATA_DIR', dataDir);
