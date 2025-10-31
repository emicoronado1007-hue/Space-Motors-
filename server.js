import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import morgan from 'morgan';
import slugify from 'slugify';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🗂️ Directorios
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// 📦 Base de datos
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new Database(DB_FILE);

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
    owners TEXT,
    repuve_status TEXT CHECK (repuve_status IN ('Limpio','Con reporte','No verificado')),
    insurance_status TEXT CHECK (insurance_status IN ('Normal','Perdida total','Rescatado','Aseguradora')),
    title_type TEXT CHECK (title_type IN ('Factura original','Refacturado')),
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
`);

// 🚀 App
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(fileUpload({ createParentPath: true }));
app.use(morgan('dev'));

// 🌐 Archivos estáticos
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(UPLOADS_DIR));

// 🔐 Auth básico (para panel admin si lo usas)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '';

const auth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'SpaceMotorsAdmin'
});

// 🧠 Helpers DB
const all = (sql, params = []) => db.prepare(sql).all(params);
const get = (sql, params = []) => db.prepare(sql).get(params);
const run = (sql, params = []) => db.prepare(sql).run(params);
const formatMoney = n => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

// 🏠 Página principal
app.get('/', (req, res) => {
  const recent = all(`
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug,
           (SELECT filename FROM images WHERE car_id = c.id ORDER BY id ASC LIMIT 1) AS image
    FROM cars AS c
    ORDER BY c.created_at DESC
    LIMIT 6
  `);
  res.render('home', { recent, formatMoney });
});
// 🚘 Inventario
app.get('/inventario', (req, res) => {
  const cars = all(`
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug,
           (SELECT filename FROM images WHERE car_id = c.id ORDER BY id ASC LIMIT 1) AS image
    FROM cars AS c
    ORDER BY c.created_at DESC
  `);
  res.render('inventory', { cars, formatMoney });
});

// 📘 Cómo comprar
app.get(['/como-comprar', '/howto', '/how-to'], (req, res) => {
  res.render('howto');
});

// 🔒 Privacidad
app.get(['/privacidad', '/privacy', '/aviso-de-privacidad'], (req, res) => {
  res.render('privacy');
});
app.get(['/privacidad', '/privacy', '/aviso-de-privacidad'], (req, res) => {
  res.render('privacy');
});

// 🔐 Protege todas las rutas /admin con Basic Auth
app.use('/admin', auth);

// 📋 Dashboard principal
app.get('/admin', (req, res) => {
  const cars = all(`
    SELECT id, title, price, year, mileage, is_sold, slug
    FROM cars
    ORDER BY created_at DESC
  `);
  res.render('dashboard', { cars, formatMoney });
});

// ➕ Formulario para crear auto
app.get('/admin/nuevo', (req, res) => {
  res.render('new'); // Vista new.ejs
});

// ✏️ Editar auto
app.get('/admin/editar/:id', (req, res) => {
  const car = get(`SELECT * FROM cars WHERE id = ?`, [req.params.id]);
  const images = all(`SELECT id, filename FROM images WHERE car_id = ? ORDER BY id`, [req.params.id]);
  if (!car) return res.status(404).render('404');
  res.render('edit', { car, images, formatMoney });
});

// 🚫 Página no encontrada
app.use((req, res) => {
  res.status(404).render('404');
});

// 🔥 Iniciar servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});
