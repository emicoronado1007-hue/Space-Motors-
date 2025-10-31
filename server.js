// ===== Space Motors - server.js (completo) =====
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

// --- Paths base (compatibles con ES Modules) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Dirs de datos e imágenes ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- BD SQLite ---
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

// --- App ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(fileUpload({ createParentPath: true }));
app.use(morgan('dev'));

// Estáticos
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(UPLOADS_DIR));

// --- Auth Admin (Basic) ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const WHATSAPP_PHONE = (process.env.WHATSAPP_PHONE || '').trim();

const auth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'SpaceMotorsAdmin'
});

// --- Helpers DB ---
const all = (sql, params = []) => db.prepare(sql).all(params);
const get = (sql, params = []) => db.prepare(sql).get(params);
const run = (sql, params = []) => db.prepare(sql).run(params);
const formatMoney = n => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

// ==================================================
//                  RUTAS PÚBLICAS
// ==================================================

// Home (últimos 6)
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

// Inventario (simple; puedes añadir filtros luego)
app.get('/inventario', (req, res) => {
  const cars = all(`
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug,
           (SELECT filename FROM images WHERE car_id = c.id ORDER BY id ASC LIMIT 1) AS image
    FROM cars AS c
    ORDER BY c.created_at DESC
  `);
  res.render('inventory', { cars, formatMoney });
});

// Detalle de auto
app.get('/auto/:slug', (req, res) => {
  const car = get(`SELECT * FROM cars WHERE slug = ?`, [req.params.slug]);
  if (!car) return res.status(404).render('404');
  const images = all(`SELECT id, filename FROM images WHERE car_id = ? ORDER BY id`, [car.id]);

  const makeMsg = (c) => {
    const v = c.vin ? ` (VIN: ${c.vin})` : '';
    return `Hola, me interesa el ${c.title}${v}.`;
  };
  const waMsg = encodeURIComponent(makeMsg(car));
  const waLink = WHATSAPP_PHONE ? `https://wa.me/${WHATSAPP_PHONE}?text=${waMsg}` : null;

  res.render('car', { car, images, waLink, formatMoney });
});

// Info
app.get(['/como-comprar','/howto','/how-to'], (req,res)=> res.render('howto'));
app.get(['/privacidad','/privacy','/aviso-de-privacidad'], (req,res)=> res.render('privacy'));

// ==================================================
//                  RUTAS ADMIN
// ==================================================
app.use('/admin', auth);

// Dashboard
app.get('/admin', (req, res) => {
  const cars = all(`
    SELECT id, title, price, year, mileage, is_sold, slug
    FROM cars
    ORDER BY created_at DESC
  `);
  res.render('dashboard', { cars, formatMoney });
});

// Nuevo (form)
app.get('/admin/nuevo', (req, res) => {
  res.render('new');
});

// Crear auto (guardar + fotos)
app.post('/admin/nuevo', async (req, res) => {
  try {
    let { title, price, year, mileage, city, description, vin, owners,
          repuve_status, insurance_status, title_type, notes_history } = req.body;

    if (!title || !price || !year || !mileage || !city) {
      return res.status(400).send('Faltan campos obligatorios');
    }

    // Validación de ciudad
    if (!['Ciudad de Mexico', 'Estado de Mexico'].includes(city)) {
      return res.status(400).send('Ciudad inválida');
    }

    // Slug único
    const slug = slugify(`${title}-${Date.now()}`, { lower: true, strict: true });

    const ins = run(`
      INSERT INTO cars (
        title, price, year, mileage, city, description, vin, owners,
        repuve_status, insurance_status, title_type, notes_history, slug
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      title.trim(),
      parseInt(price), parseInt(year), parseInt(mileage),
      city,
      description || null, vin || null, owners || null,
      repuve_status || null, insurance_status || null, title_type || null,
      notes_history || null,
      slug
    ]);

    const carId = ins.lastInsertRowid;

    // Guardar fotos (si hay)
    if (req.files && req.files.photos) {
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for (const f of files) {
        const safe = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9_.-]/g,'_')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await f.mv(savePath);
        run(`INSERT INTO images (car_id, filename) VALUES (?, ?)`, [carId, safe]);
      }
    }

    res.redirect('/admin');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al crear el auto');
  }
});

// Editar (vista)
app.get('/admin/editar/:id', (req, res) => {
  const car = get(`SELECT * FROM cars WHERE id = ?`, [req.params.id]);
  if (!car) return res.status(404).render('404');
  const images = all(`SELECT id, filename FROM images WHERE car_id = ? ORDER BY id`, [req.params.id]);
  res.render('edit', { car, images, formatMoney });
});

// Actualizar auto + agregar fotos
app.put('/admin/editar/:id', async (req, res) => {
  try {
    const {
      title, price, year, mileage, city, description,
      vin, owners, repuve_status, insurance_status, title_type, notes_history
    } = req.body;
    const is_sold = req.body.is_sold ? 1 : 0;

    run(`
      UPDATE cars SET
        title=?, price=?, year=?, mileage=?, city=?, description=?, vin=?, owners=?,
        repuve_status=?, insurance_status=?, title_type=?, notes_history=?, is_sold=?
      WHERE id=?
    `, [
      title, parseInt(price), parseInt(year), parseInt(mileage), city, description || null,
      vin || null, owners || null, repuve_status || null, insurance_status || null,
      title_type || null, notes_history || null, is_sold, req.params.id
    ]);

    // nuevas fotos
    if (req.files && req.files.photos) {
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for (const f of files) {
        const safe = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9_.-]/g,'_')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await f.mv(savePath);
        run(`INSERT INTO images (car_id, filename) VALUES (?, ?)`, [req.params.id, safe]);
      }
    }

    res.redirect(`/admin/editar/${req.params.id}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al actualizar el auto');
  }
});

// Borrar una foto
app.delete('/admin/imagen/:imgId', (req, res) => {
  try {
    const img = get(`SELECT id, filename, car_id FROM images WHERE id = ?`, [req.params.imgId]);
    if (!img) return res.status(404).render('404');

    const filePath = path.join(UPLOADS_DIR, img.filename);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}

    run(`DELETE FROM images WHERE id = ?`, [img.id]);
    res.redirect(`/admin/editar/${img.car_id}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al borrar la imagen');
  }
});

// ==================================================
//                    404 y START
// ==================================================
app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🚀 Servidor activo en puerto', PORT);
  console.log('DATA_DIR:', DATA_DIR);
  console.log('IMAGES_DIR:', UPLOADS_DIR);
});
