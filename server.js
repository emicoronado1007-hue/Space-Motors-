import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import fileUpload from 'express-fileupload';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

// --- Configuración de rutas base ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'public', 'images');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Base de datos ---
const db = new Database(path.join(DATA_DIR, 'data.db'));

// --- Configuración del servidor ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));
app.use(fileUpload({ createParentPath: true }));

// --- Servir archivos estáticos ---
app.use('/images', express.static(UPLOADS_DIR));
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- Autenticación básica para panel admin ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '';

const auth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'SpaceMotorsAdmin',
});

// --- Helpers SQL ---
const q = (sql, params = []) => db.prepare(sql).all(params);
const run = (sql, params = []) => db.prepare(sql).run(params);
const get = (sql, params = []) => db.prepare(sql).get(params);

// --- Formateo de precios ---
function formatMoney(n) {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

// --- Rutas públicas ---
app.get('/', (req, res) => {
  const recent = q(`
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug, c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c ORDER BY created_at DESC LIMIT 6
  `);
  res.render('site/home', { recent, formatMoney });
});

app.get('/inventario', (req, res) => {
  const { term, ciudad, min, max, year, repuve, insurance } = req.query;
  let sql = `
    SELECT c.id, c.title, c.price, c.year, c.mileage, c.city, c.slug, c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c WHERE 1=1
  `;
  const params = [];

  if (term) sql += ` AND (c.title LIKE ? OR c.description LIKE ?)`, params.push(`%${term}%`, `%${term}%`);
  if (ciudad) sql += ` AND c.city=?`, params.push(ciudad);
  if (min) sql += ` AND c.price>=?`, params.push(parseInt(min));
  if (max) sql += ` AND c.price<=?`, params.push(parseInt(max));
  if (year) sql += ` AND c.year=?`, params.push(parseInt(year));
  if (repuve) sql += ` AND c.repuve_status=?`, params.push(repuve);
  if (insurance) sql += ` AND c.insurance_status=?`, params.push(insurance);

  sql += ` ORDER BY c.created_at DESC`;

  const cars = q(sql, params);
  res.render('site/inventory', { cars, formatMoney, filters: req.query });
});

// --- Ver detalle de un auto ---
app.get('/auto/:slug', (req, res) => {
  const car = get(`SELECT * FROM cars WHERE slug=?`, [req.params.slug]);
  if (!car) return res.status(404).send('Auto no encontrado');

  const images = q(`SELECT * FROM images WHERE car_id=?`, [car.id]);
  const link = `https://wa.me/${WHATSAPP_PHONE}?text=Hola, me interesa el ${car.title} (${car.year})`;

  res.render('site/car', { car, images, link, formatMoney });
});

// --- Endpoint API ---
app.get('/api/cars', (req, res) => {
  const cars = q(`
    SELECT c.*, (
      SELECT json_group_array(
        json_object('url', i.filename)
      ) FROM images i WHERE i.car_id=c.id
    ) AS images
    FROM cars c ORDER BY created_at DESC
  `);
  res.json(cars);
});

// --- Panel admin ---
app.get('/admin', auth, (req, res) => {
  const cars = q(`SELECT id, title, city, price, year FROM cars ORDER BY id DESC`);
  res.render('admin/dashboard', { cars, formatMoney });
});

// --- Crear nuevo auto ---
app.post('/admin/nuevo', auth, async (req, res) => {
  try {
    const { title, price, year, mileage, city, description } = req.body;
    const slug = slugify(`${title}-${Date.now()}`, { lower: true });
    const result = run(
      `INSERT INTO cars (title, price, year, mileage, city, description, slug)
       VALUES (?,?,?,?,?,?,?)`,
      [title, price, year, mileage, city, description, slug]
    );
    const carId = result.lastInsertRowid;

    if (req.files && req.files.photos) {
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for (const file of files) {
        const safe = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await file.mv(savePath);
        run(`INSERT INTO images (car_id, filename) VALUES (?,?)`, [carId, safe]);
      }
    }
    res.redirect('/admin');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error al crear auto');
  }
});

// --- Eliminar auto ---
app.post('/admin/eliminar/:id', auth, (req, res) => {
  run(`DELETE FROM cars WHERE id=?`, [req.params.id]);
  run(`DELETE FROM images WHERE car_id=?`, [req.params.id]);
  res.redirect('/admin');
});

// --- Página de privacidad y cómo comprar ---
app.get('/aviso-de-privacidad', (req, res) => res.render('site/privacy'));
app.get('/como-comprar', (req, res) => res.render('site/howto'));

// --- Error 404 ---
app.use((req, res) => res.status(404).render('site/404'));

// --- Iniciar servidor ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Space Motors server running on port ${PORT}`);
  console.log(`➡️ DATA_DIR: ${DATA_DIR}`);
  console.log(`➡️ IMAGES_DIR: ${UPLOADS_DIR}`);
});
