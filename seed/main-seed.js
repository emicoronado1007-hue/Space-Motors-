import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Guardar la base de datos dentro del proyecto (compatible con Render)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Ruta del archivo de base de datos
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new Database(DB_FILE);

// Crear tablas (idénticas a las del server.js)
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    price INTEGER NOT NULL,
    year INTEGER NOT NULL,
    mileage INTEGER NOT NULL,
    city TEXT NOT NULL CHECK (city IN ('Ciudad de Mexico','Estado de Mexico')),
    description TEXT,
    vin TEXT,
    owners INTEGER,
    repuve_status TEXT CHECK (repuve_status IN ('Limpio','Con reporte','No verificado')) DEFAULT 'No verificado',
    insurance_status TEXT CHECK (insurance_status IN ('Normal','Perdida total','Rescatado','Aseguradora')) DEFAULT 'Normal',
    title_type TEXT CHECK (title_type IN ('Factura original','Refacturado','Aseguradora')) DEFAULT 'Factura original',
    notes_history TEXT,
    slug TEXT UNIQUE NOT NULL,
    is_sold INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    car_id INTEGER NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
    filename TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_images_car_id ON images(car_id);

  DELETE FROM images;
  DELETE FROM cars;
  VACUUM;
`);

// Insertar un auto de ejemplo (Mazda 3)
const insertCar = db.prepare(`
  INSERT INTO cars (
    title, price, year, mileage, city, description, vin, owners,
    repuve_status, insurance_status, title_type, notes_history, slug, is_sold
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertImg = db.prepare(`INSERT INTO images (car_id, filename) VALUES (?, ?)`);

// Datos del Mazda 3
const title = 'Mazda 3 i Touring';
const slug = `${title}-${Date.now()}`.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const info = insertCar.run(
  title,                   // title
  158000,                  // price
  2017,                    // year
  78500,                   // mileage
  'Ciudad de Mexico',      // city
  'Muy cuidado, servicios al día', // description
  'JM1BN123456789000',     // vin
  1,                       // owners
  'Limpio',                // repuve_status
  'Normal',                // insurance_status
  'Factura original',      // title_type
  'Sin observaciones',     // notes_history
  slug,                    // slug
  0                        // is_sold
);

const carId = info.lastInsertRowid;

// Insertar imágenes de ejemplo (asegúrate de tenerlas en /public/images/mazda3/)
insertImg.run(carId, 'mazda3/1.jpg');
insertImg.run(carId, 'mazda3/2.jpg');
insertImg.run(carId, 'mazda3/3.jpg');

console.log('✅ Base de datos creada correctamente en:', DB_FILE);
console.log('✅ Mazda 3 insertado correctamente con ID:', carId);
console.log('Space Motors seed final ejecutado con éxito 🚀');
