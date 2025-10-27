import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'data.db'));

// Activar llaves foráneas y crear tablas
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    price INTEGER,
    year INTEGER,
    mileage INTEGER,
    city TEXT,
    slug TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    alt TEXT,
    is_cover INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_images_car_id ON images(car_id);
`);

// Limpiar tablas
db.exec('DELETE FROM images; DELETE FROM cars; VACUUM;');

// Insertar coche de ejemplo
const insertCar = db.prepare(
  'INSERT INTO cars (title, price, year, mileage, city, slug) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertImg = db.prepare(
  'INSERT INTO images (car_id, url, alt, is_cover, sort_order) VALUES (?, ?, ?, ?, ?)'
);

const slugify = s =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();

const carTitle = 'Mazda 3 i Touring';
const carSlug = slugify(carTitle);

const info = insertCar.run(carTitle, 158000, 2017, 78500, 'Ciudad de México', carSlug);
const carId = info.lastInsertRowid;

// Insertar imágenes
insertImg.run(carId, '/images/mazda3/1.jpg', 'Mazda 3 frente', 1, 0);
insertImg.run(carId, '/images/mazda3/2.jpg', 'Mazda 3 interior', 0, 1);
insertImg.run(carId, '/images/mazda3/3.jpg', 'Mazda 3 tablero', 0, 2);

console.log('Seed ejecutado correctamente ✅ con DATA_DIR:', dataDir);
