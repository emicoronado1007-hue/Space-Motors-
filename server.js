import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import morgan from 'morgan';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import slugify from 'slugify';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rutas de datos/imagenes (compatibles con Render)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'images');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Base de datos
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new Database(DB_FILE);

// Crear tablas (y FK)
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

// App
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // << importante

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));
app.use(fileUpload({ createParentPath: true }));

// Estáticos
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(UPLOADS_DIR));

// Auth básica (panel admin si lo usas)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '';

const auth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASS },
  challenge: true,
  realm: 'SpaceMotorsAdmin',
});

// Helpers DB
const q = (sql, params = []) => db.prepare(sql).all(params);
const run = (sql, params = []) => db.prepare(sql).run(params);
const get = (sql, params = []) => db.prepare(sql).get(params);
function formatMoney(n){ return n.toLocaleString('es-MX',{style:'currency',currency:'MXN'}); }

// Rutas públicas
app.get('/', (req,res)=>{
  const recent = q(`
    SELECT c.id,c.title,c.price,c.year,c.mileage,c.city,c.slug,c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c ORDER BY created_at DESC LIMIT 6
  `);
  res.render('home', { recent, formatMoney });
});

app.get('/inventario', (req,res)=>{
  const { q:term, ciudad, min, max, year, repuve, insurance } = req.query;
  let sql = `
    SELECT c.id,c.title,c.price,c.year,c.mileage,c.city,c.slug,c.is_sold,
          (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c WHERE 1=1
  `;
  const params=[];
  if(term) { sql += ` AND (c.title LIKE ? OR c.description LIKE ?) `; params.push(`%${term}%`,`%${term}%`); }
  if(ciudad && ['Ciudad de Mexico','Estado de Mexico'].includes(ciudad)) { sql += ` AND c.city=? `; params.push(ciudad); }
  if(min){ sql += ` AND c.price>=?`; params.push(parseInt(min)); }
  if(max){ sql += ` AND c.price<=?`; params.push(parseInt(max)); }
  if(year){ sql += ` AND c.year>=?`; params.push(parseInt(year)); }
  if(repuve && ['Limpio','Con reporte','No verificado'].includes(repuve)){ sql+=` AND c.repuve_status=?`; params.push(repuve); }
  if(insurance && ['Normal','Perdida total','Rescatado','Aseguradora'].includes(insurance)){ sql+=` AND c.insurance_status=?`; params.push(insurance); }
  sql += ` ORDER BY c.created_at DESC`;

  const cars = q(sql, params);
  res.render('inventory', { cars, formatMoney, filters:{term,ciudad,min,max,year,repuve,insurance} });
});

app.get('/auto/:slug', (req,res)=>{
  const car = get(`SELECT * FROM cars WHERE slug=?`, [req.params.slug]);
  if(!car) return res.status(404).send('Auto no encontrado');
  const images = q(`SELECT * FROM images WHERE car_id=? ORDER BY id`, [car.id]);

  const vin6 = car.vin ? car.vin.trim().toUpperCase().slice(-6) : '';
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  const waMsg = encodeURIComponent(`Hola, me interesa el ${car.title} ${car.year} (${vin6 ? 'VIN • ' + vin6 : ''})`);
  const waLink = `https://wa.me/${WHATSAPP_PHONE}?text=${waMsg}`;

  res.render('car', { car, images, waLink, formatMoney });
});

// API
app.get('/api/cars', (req,res)=>{
  const cars = q(`SELECT * FROM cars ORDER BY id DESC`);
  const imgs = db.prepare(`SELECT id,car_id,filename FROM images WHERE car_id=? ORDER BY id`).all;
  const result = cars.map(c => ({
    ...c,
    images: q(`SELECT filename FROM images WHERE car_id=? ORDER BY id`, [c.id]).map(r => `/images/${r.filename}`)
  }));
  res.json(result);
});

// (Opcional) Rutas admin para crear/editar con subida de fotos
app.post('/admin/nuevo', auth, async (req,res)=>{
  try{
    const { title, price, year, mileage, city, description, vin, owners,
            repuve_status, insurance_status, title_type, notes_history } = req.body;

    if(!['Ciudad de Mexico','Estado de Mexico'].includes(city)) return res.status(400).send('Ciudad invalida');
    const slug = slugify(`${title}-${Date.now()}`, { lower:true, strict:true });

    const ins = run(`
      INSERT INTO cars (title,price,year,mileage,city,description,vin,owners,repuve_status,insurance_status,title_type,notes_history,slug)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [title, parseInt(price), parseInt(year), parseInt(mileage), city, description, (vin||null), owners?parseInt(owners):null,
        repuve_status, insurance_status, title_type, notes_history, slug]);

    const carId = ins.lastInsertRowid;

    if(req.files && req.files.photos){
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for(const f of files.slice(0,10)){
        const safe = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '').replace(/\s+/g, '_')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await f.mv(savePath);
        run(`INSERT INTO images (car_id,filename) VALUES (?,?)`, [carId, safe]);
      }
    }

    res.redirect('/'); // o al dashboard si lo usas
  }catch(e){ console.error(e); res.status(500).send('Error al crear: '+e.message); }
});

app.use((req,res)=> res.status(404).render('404'));

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> {
  console.log('Space Motors server running on port', PORT);
  console.log('DATA_DIR:', DATA_DIR);
  console.log('IMAGES_DIR:', UPLOADS_DIR);
});
