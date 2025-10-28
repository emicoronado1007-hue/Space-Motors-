// server.js — Space Motors (versión corregida para Render / HTTPS / views en carpeta raíz)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// --- Rutas base del proyecto ---
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Carpetas de datos y estáticos (compatibles con Render)
const DATA_DIR    = process.env.DATA_DIR    || path.join(process.cwd(), 'data');
const PUBLIC_DIR  = path.join(__dirname, 'public');
const IMAGES_DIR  = path.join(PUBLIC_DIR, 'images');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(PUBLIC_DIR, 'uploads');

fs.mkdirSync(DATA_DIR,    { recursive: true });
fs.mkdirSync(PUBLIC_DIR,  { recursive: true });
fs.mkdirSync(IMAGES_DIR,  { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Base de datos ---
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new Database(DB_FILE);

// Asegura esquema (por si la DB viene vieja)
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
`);

// --- App / middlewares ---
const app = express();
app.set('view engine', 'ejs');
// 💡 OJO: vistas en carpeta raíz "views" (NO "views/site")
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));
app.use(fileUpload({ createParentPath: true }));

// Estáticos (HTTPS-safe, rutas relativas)
app.use('/public',  express.static(PUBLIC_DIR));
app.use('/images',  express.static(IMAGES_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Auth para panel admin (simple) ---
const ADMIN_USER  = process.env.ADMIN_USER  || 'admin';
const ADMIN_PASS  = process.env.ADMIN_PASS  || 'password';
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '';

const auth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'SpaceMotorsAdmin',
});

// --- Helpers SQL ---
const q    = (sql, params = []) => db.prepare(sql).all(params);
const run  = (sql, params = []) => db.prepare(sql).run(params);
const get  = (sql, params = []) => db.prepare(sql).get(params);

const formatMoney = (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

// --- RUTAS PÚBLICAS ---

// Home
app.get('/', (req, res) => {
  const recent = q(`
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug, c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c
    ORDER BY created_at DESC
    LIMIT 6
  `);
  res.render('home', { recent, formatMoney });
});

// Inventario con filtros
app.get('/inventario', (req, res) => {
  const { term, ciudad, min, max, year, repuve, insurance } = req.query;

  let sql = `
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug, c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c
    WHERE 1=1
  `;
  const params = [];

  if (term && term.trim() !== '') {
    sql += ` AND (c.title LIKE ? OR c.description LIKE ? OR c.vin LIKE ?)`;
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  if (ciudad && (ciudad === 'Ciudad de Mexico' || ciudad === 'Estado de Mexico')) {
    sql += ` AND c.city = ?`;
    params.push(ciudad);
  }
  if (min) { sql += ` AND c.price >= ?`; params.push(parseInt(min)); }
  if (max) { sql += ` AND c.price <= ?`; params.push(parseInt(max)); }
  if (year){ sql += ` AND c.year  = ?`; params.push(parseInt(year)); }

  if (repuve && ['Limpio','Con reporte','No verificado'].includes(repuve)) {
    sql += ` AND c.repuve_status = ?`; params.push(repuve);
  }
  if (insurance && ['Normal','Perdida total','Rescatado','Aseguradora'].includes(insurance)) {
    sql += ` AND c.insurance_status = ?`; params.push(insurance);
  }

  sql += ` ORDER BY c.created_at DESC`;

  const cars = q(sql, params);
  res.render('inventory', { cars, formatMoney, filters: { term, ciudad, min, max, year, repuve, insurance } });
});

// Detalle de auto por slug
app.get('/auto/:slug', (req, res) => {
  const car = get(`SELECT * FROM cars WHERE slug=?`, [req.params.slug]);
  if (!car) return res.status(404).send('Auto no encontrado');

  const images = q(`SELECT * FROM images WHERE car_id=? ORDER BY id ASC`, [car.id]);

  const vin6   = (car.vin || '').toUpperCase().slice(-6);
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const waMsg  = encodeURIComponent(`Hola, me interesa el ${car.title} ${car.year} (VIN • ${vin6})`);
  const waLink = WHATSAPP_PHONE ? `https://wa.me/${WHATSAPP_PHONE}?text=${waMsg}` : '#';

  res.render('car', { car, images, waLink, formatMoney });
});

// --- API pública ---

// Listado de autos con imágenes
app.get('/api/cars', (req, res) => {
  const cars = q(`
    SELECT c.*,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c
    ORDER BY id DESC
  `);
  const imgsStmt = db.prepare(`SELECT id, filename FROM images WHERE car_id=? ORDER BY id ASC`);
  const out = cars.map(c => ({
    ...c,
    images: imgsStmt.all(c.id).map(x => x.filename),
  }));
  res.json(out);
});

// --- RUTAS ADMIN (opcionales) ---

// Dashboard simple
app.get('/admin', auth, (req, res) => {
  const cars = q(`SELECT id,title,price,year,mileage,city,slug,is_sold FROM cars ORDER BY id DESC`);
  res.render('admin/dashboard', { cars, formatMoney }); // si no tienes estas vistas, puedes quitar estas rutas.
});

// Crear auto (ejemplo rápido)
app.post('/admin/nuevo', auth, async (req, res) => {
  try {
    const {
      title, price, year, mileage, city, description,
      vin, owners, repuve_status, insurance_status, title_type, notes_history
    } = req.body;

    if (!['Ciudad de Mexico','Estado de Mexico'].includes(city)) {
      return res.status(400).send('Ciudad inválida');
    }

    const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const slug = slugify(`${title}-${Date.now()}`);

    const info = run(`
      INSERT INTO cars (title,price,year,mileage,city,description,vin,owners,
                        repuve_status,insurance_status,title_type,notes_history,slug,is_sold)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)
    `, [
      title, parseInt(price), parseInt(year), parseInt(mileage), city, description || null,
      vin || null, owners ? parseInt(owners) : null,
      repuve_status || 'No verificado', insurance_status || 'Normal',
      title_type || 'Factura original', notes_history || null, slug
    ]);

    const carId = info.lastInsertRowid;

    // Subida de hasta 10 fotos
    if (req.files && req.files.photos) {
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for (const f of files.slice(0, 10)) {
        const safe =`${Date.now()}-${f.name.replace(/[^a-zA-Z0-9.\-_/g, '').replace(/\s+/g, '_')}`;
        const dest = path.join(UPLOADS_DIR, safe);
        await f.mv(dest);
        run(`INSERT INTO images (car_id, filename) VALUES (?,?)`, [carId, `/uploads/${safe}`]);
      }
    }

    res.redirect(`/auto/${slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al crear: ' + e.message);
  }
});

// --- 404 ---
app.use((req, res) => res.status(404).render('404'));

// --- Start ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Space Motors server running on port ${PORT}`);
  console.log('DATA_DIR:', DATA_DIR);
  console.log('IMAGES_DIR:', IMAGES_DIR);
});
