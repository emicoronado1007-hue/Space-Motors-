¡Listo! Aquí tienes un server.js completo (ESM) para copiar/pegar.
Incluye:
	•	Rutas de archivos con process.cwd() (igual que tu seed) ✅
	•	/images estático desde public/images ✅
	•	Creación de tablas cars e images si no existen ✅
	•	Endpoints de API y vistas EJS básicas (home, inventario, detalle) ✅

Pega esto tal cual en tu server.js y haz deploy (recomendado: Manual Deploy → Clear build cache & deploy).

// server.js (ESM)
// ------------------------------
// Space Motors - servidor Express listo para Render

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import fileUpload from 'express-fileupload';
import slugifyLib from 'slugify';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Rutas base del proyecto (compatibles con Render)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usamos el directorio del proyecto para archivos de escritura
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

// Aseguramos carpetas
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

// Conexión a la base de datos (misma ruta que el seed)
const db = new Database(path.join(DATA_DIR, 'data.db'));

// Crear tablas si no existen (por si el seed no corrió)
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    price INTEGER,
    year INTEGER,
    mileage INTEGER,
    city TEXT,
    slug TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// Helpers
const slugify = (s) =>
  slugifyLib(s || '', {
    lower: true,
    strict: true,
    trim: true,
  }) + '-' + Date.now();

// App
const app = express();

// Vistas EJS (si usas ejs en /views)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname));

// Middlewares
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(fileUpload());

// Archivos estáticos
app.use('/images', express.static(IMAGES_DIR));
app.use('/public', express.static(PUBLIC_DIR)); // por si usas /public/* en CSS/JS

// ------------------------------
// API
// ------------------------------
app.get('/api/cars', (req, res) => {
  const cars = db.prepare('SELECT * FROM cars ORDER BY id DESC').all();
  const imgsStmt = db.prepare(`
    SELECT id, url, alt, is_cover, sort_order
    FROM images
    WHERE car_id = ?
    ORDER BY is_cover DESC, sort_order ASC, id ASC
  `);
  const result = cars.map((c) => ({ ...c, images: imgsStmt.all(c.id) }));
  res.json(result);
});

app.get('/api/cars/:slug', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE slug = ?').get(req.params.slug);
  if (!car) return res.status(404).json({ error: 'Not found' });

  const images = db.prepare(`
    SELECT id, url, alt, is_cover, sort_order
    FROM images
    WHERE car_id = ?
    ORDER BY is_cover DESC, sort_order ASC, id ASC
  `).all(car.id);

  res.json({ ...car, images });
});

// (Opcional) crear auto rápido vía POST JSON
app.post('/api/cars', (req, res) => {
  const { title, price, year, mileage, city, images = [] } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  const carSlug = slugify(title);
  const insertCar = db.prepare(
    'INSERT INTO cars (title, price, year, mileage, city, slug) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const info = insertCar.run(title, price ?? null, year ?? null, mileage ?? null, city ?? null, carSlug);
  const carId = info.lastInsertRowid;

  const insertImg = db.prepare(
    'INSERT INTO images (car_id, url, alt, is_cover, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  images.forEach((img, idx) => {
    insertImg.run(carId, img.url, img.alt || '', img.is_cover ? 1 : 0, img.sort_order ?? idx);
  });

  res.status(201).json({ slug: carSlug, id: carId });
});

// ------------------------------
// Subida rápida de imágenes al folder /public/images (opcional)
// Envia desde un form <input type="file" name="photo">
app.post('/upload', async (req, res) => {
  try {
    if (!req.files || !req.files.photo) {
      return res.status(400).send('No file uploaded');
    }
    const photo = req.files.photo;
    const fileName = `${Date.now()}-${photo.name}`;
    const savePath = path.join(IMAGES_DIR, fileName);
    await photo.mv(savePath);
    res.json({ url: `/images/${fileName}` });
  } catch (e) {
    console.error(e);
    res.status(500).send('Upload error');
  }
});

// ------------------------------
// Vistas (ajústalas a tus .ejs si las usas)
app.get('/', (req, res) => {
  const cars = db.prepare('SELECT * FROM cars ORDER BY id DESC LIMIT 12').all();
  const coverStmt = db.prepare(
    'SELECT url FROM images WHERE car_id = ? ORDER BY is_cover DESC, sort_order ASC, id ASC LIMIT 1'
  );
  const items = cars.map((c) => {
    const cover = coverStmt.get(c.id);
    return { ...c, cover: cover?.url || null };
  });

  // Si tienes views/home.ejs, úsalo. Si tu archivo está en otra ruta, ajústalo.
  res.render('home.ejs', { cars: items });
});

app.get('/inventory', (req, res) => {
  const cars = db.prepare('SELECT * FROM cars ORDER BY id DESC').all();
  res.render('inventory.ejs', { cars });
});

app.get('/cars/:slug', (req, res) => {
  const car = db.prepare('SELECT * FROM cars WHERE slug = ?').get(req.params.slug);
  if (!car) return res.status(404).render('404.ejs');

  const images = db.prepare(
    'SELECT * FROM images WHERE car_id = ? ORDER BY is_cover DESC, sort_order ASC, id ASC'
  ).all(car.id);

  res.render('car.ejs', { car, images });
});

// ------------------------------
// Admin básico (opcional) con basic-auth
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  app.use(
    '/admin',
    basicAuth({
      users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
      challenge: true,
    })
  );

  app.get('/admin', (req, res) => {
    const cars = db.prepare('SELECT * FROM cars ORDER BY id DESC').all();
    res.render('dashboard.ejs', { cars });
  });
}

// ------------------------------
// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ Space Motors server running on port', PORT);
  console.log('➡️ DATA_DIR:', DATA_DIR);
  console.log('➡️ IMAGES_DIR:', IMAGES_DIR);
});

Después de pegarlo
	1.	Guarda el archivo en GitHub.
	2.	En Render: Manual Deploy → Clear build cache & deploy.
	3.	Prueba:

	•	/api/cars
	•	/images/mazda3/1.jpg
	•	/ (home), /inventory, /cars/<slug> (si tus EJS están listos).

Si quieres, también te dejo de nuevo el seed/main-seed.js final para que tengas ambos archivos gemelos y sin riesgos.
