import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Guardar DB dentro del proyecto (compatible con Render)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 📄 Ruta de archivo de base de datos
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new Database(DB_FILE);

// 🧩 Crear tablas con todas las columnas nuevas
db.exec(`
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
`);

console.log('✅ Base de datos creada correctamente en:', DB_FILE);

// 🚗 Insertar auto de ejemplo si la tabla está vacía
const count = db.prepare(`SELECT COUNT(*) AS total FROM cars`).get().total;
if (count === 0) {
  const insertCar = db.prepare(`
    INSERT INTO cars (title, price, year, mileage, city, description, vin, owners, repuve_status, insurance_status, title_type, notes_history, slug, is_sold)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const carTitle = 'Mazda 3 i Touring';
  const carSlug = slugify(carTitle + '-' + Date.now());

  const info = insertCar.run(
    carTitle,
    158000,
    2017,
    78500,
    'Ciudad de Mexico',
    'Ejemplo de auto en inventario inicial',
    'VIN1234567890',
    1,
    'Limpio',
    'Normal',
    'Factura original',
    null,
    carSlug,
    0
  );

  const carId = info.lastInsertRowid;
  const insertImg = db.prepare(`INSERT INTO images (car_id, filename) VALUES (?, ?)`);

  insertImg.run(carId, '/images/mazda3/1.jpg');
  insertImg.run(carId, '/images/mazda3/2.jpg');
  insertImg.run(carId, '/images/mazda3/3.jpg');

  console.log('🚘 Mazda 3 insertado correctamente con ID:', carId);
}
