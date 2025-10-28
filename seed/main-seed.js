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
