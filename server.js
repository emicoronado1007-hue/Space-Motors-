import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fileUpload from 'express-fileupload';
import Database from 'better-sqlite3';
import morgan from 'morgan';
import env from 'dotenv';
import basicAuth from 'express-basic-auth';
import methodOverride from 'method-override';
import slugify from 'slugify';
import fs from 'fs';

env.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'data.db'));

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

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(fileUpload({ createParentPath: true }));

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const WHATSAPP = process.env.WHATSAPP_PHONE || '';

const auth = basicAuth({ users: { [ADMIN_USER]: ADMIN_PASS }, challenge: true, realm: 'SpaceMotorsAdmin' });

const q = (sql, params=[]) => db.prepare(sql).all(params);
const run = (sql, params=[]) => db.prepare(sql).run(params);
const get = (sql, params=[]) => db.prepare(sql).get(params);

function formatMoney(n){ return n.toLocaleString('es-MX',{style:'currency',currency:'MXN'}); }

app.get('/', (req,res)=>{
  const recent = q(`SELECT c.id,c.title,c.price,c.year,c.mileage,c.city,c.slug,c.is_sold,
           (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
    FROM cars c ORDER BY created_at DESC LIMIT 6`);
  res.render('site/home', { recent, formatMoney });
});

app.get('/inventario', (req,res)=>{
  const { q:term, ciudad, min, max, year, repuve, insurance } = req.query;
  let sql = `SELECT c.id,c.title,c.price,c.year,c.mileage,c.city,c.slug,c.is_sold,
            (SELECT filename FROM images WHERE car_id=c.id ORDER BY id ASC LIMIT 1) AS cover
            FROM cars c WHERE 1=1`;
  const params=[];
  if(term){ sql += ' AND (c.title LIKE ? OR c.description LIKE ?)'; params.push('%'+term+'%','%'+term+'%'); }
  if(ciudad && ['Ciudad de Mexico','Estado de Mexico'].includes(ciudad)){ sql += ' AND c.city=?'; params.push(ciudad); }
  if(min){ sql += ' AND c.price>=?'; params.push(parseInt(min)); }
  if(max){ sql += ' AND c.price<=?'; params.push(parseInt(max)); }
  if(year){ sql += ' AND c.year>=?'; params.push(parseInt(year)); }
  if(repuve && ['Limpio','Con reporte','No verificado'].includes(repuve)){ sql += ' AND c.repuve_status=?'; params.push(repuve); }
  if(insurance && ['Normal','Perdida total','Rescatado','Aseguradora'].includes(insurance)){ sql += ' AND c.insurance_status=?'; params.push(insurance); }
  sql += ' ORDER BY c.created_at DESC';
  const cars = q(sql, params);
  res.render('site/inventory', { cars, formatMoney, filters:{term, ciudad, min, max, year, repuve, insurance} });
});

app.get('/auto/:slug', (req,res)=>{
  const car = get('SELECT * FROM cars WHERE slug=?', [req.params.slug]);
  if(!car) return res.status(404).send('Auto no encontrado');
  const images = q('SELECT * FROM images WHERE car_id=?', [car.id]);
  const vin6 = car.vin ? car.vin.trim().toUpperCase().slice(-6) : '';
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  const waMsg = encodeURIComponent('Hola, me interesa el ' + car.title + ' (' + car.year + ')' + (vin6 ? ' — VIN ' + vin6 : '') + ' que vi en Space Motors: ' + fullUrl);
  const waLink = `https://wa.me/${WHATSAPP}?text=${waMsg}`;
  res.render('site/car', { car, images, waLink, formatMoney });
});

// Compare (optional)
app.get('/comparar', (req,res)=>{
  const { a, b } = req.query;
  if(!a || !b) return res.status(400).send('Selecciona dos autos (?a=slug1&b=slug2)');
  const carA = get('SELECT * FROM cars WHERE slug=? OR id=?', [a, a]);
  const carB = get('SELECT * FROM cars WHERE slug=? OR id=?', [b, b]);
  if(!carA || !carB) return res.status(404).send('Auto no encontrado');
  res.render('site/compare', { carA, carB, formatMoney });
});

// ADMIN
app.get('/admin', auth, (req,res)=>{
  const cars = q('SELECT id,title,price,year,mileage,city,slug,is_sold FROM cars ORDER BY created_at DESC');
  res.render('admin/dashboard',{ cars, formatMoney });
});
app.get('/admin/nuevo', auth, (req,res)=> res.render('admin/new'));
app.post('/admin/nuevo', auth, async (req,res)=>{
  try{
    const { title, price, year, mileage, city, description,
            vin, owners, repuve_status, insurance_status, title_type, notes_history } = req.body;
    if(!['Ciudad de Mexico','Estado de Mexico'].includes(city)) return res.status(400).send('Ciudad invalida');
    const slug = slugify(`${title}-${year}-${Date.now()}`, { lower:true, strict:true });
    const result = run(`INSERT INTO cars (title,price,year,mileage,city,description,vin,owners,repuve_status,insurance_status,title_type,notes_history,slug)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, parseInt(price), parseInt(year), parseInt(mileage), city, description, (vin||null), owners?parseInt(owners):null,
       repuve_status, insurance_status, title_type, notes_history, slug]);
    const carId = result.lastInsertRowid;

    if(req.files && req.files.photos){
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for(const file of files.slice(0,10)){
        const safe = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await file.mv(savePath);
        run('INSERT INTO images (car_id,filename) VALUES (?,?)',[carId, safe]);
      }
    }
    res.redirect('/admin');
  }catch(e){ console.error(e); res.status(500).send('Error al crear: '+e.message); }
});

app.get('/admin/editar/:id', auth, (req,res)=>{
  const car = get('SELECT * FROM cars WHERE id=?', [req.params.id]);
  if(!car) return res.status(404).send('No encontrado');
  const images = q('SELECT * FROM images WHERE car_id=?', [car.id]);
  res.render('admin/edit', { car, images });
});
app.post('/admin/editar/:id', auth, async (req,res)=>{
  try{
    const { title, price, year, mileage, city, description,
            vin, owners, repuve_status, insurance_status, title_type, notes_history, is_sold } = req.body;
    if(!['Ciudad de Mexico','Estado de Mexico'].includes(city)) return res.status(400).send('Ciudad invalida');
    run(`UPDATE cars SET title=?,price=?,year=?,mileage=?,city=?,description=?,vin=?,owners=?,repuve_status=?,insurance_status=?,title_type=?,notes_history=?,is_sold=? WHERE id=?`,
        [title, parseInt(price), parseInt(year), parseInt(mileage), city, description, (vin||null), owners?parseInt(owners):null,
         repuve_status, insurance_status, title_type, notes_history, is_sold?1:0, req.params.id]);

    if(req.files && req.files.photos){
      const files = Array.isArray(req.files.photos) ? req.files.photos : [req.files.photos];
      for(const file of files.slice(0,10)){
        const safe = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const savePath = path.join(UPLOADS_DIR, safe);
        await file.mv(savePath);
        run('INSERT INTO images (car_id,filename) VALUES (?,?)',[req.params.id, safe]);
      }
    }
    res.redirect('/admin');
  }catch(e){ console.error(e); res.status(500).send('Error al actualizar: '+e.message); }
});

app.post('/admin/eliminar-foto/:imageId', auth, (req,res)=>{
  const img = get('SELECT * FROM images WHERE id=?',[req.params.imageId]);
  if(img){
    const fp = path.join(UPLOADS_DIR, img.filename);
    try{ fs.unlinkSync(fp); }catch{}
    run('DELETE FROM images WHERE id=?',[img.id]);
  }
  res.redirect('back');
});
app.post('/admin/eliminar/:id', auth, (req,res)=>{
  run('DELETE FROM cars WHERE id=?',[req.params.id]);
  res.redirect('/admin');
});

app.get('/aviso-de-privacidad', (req,res)=> res.render('site/privacy'));
app.get('/como-comprar', (req,res)=> res.render('site/howto'));

app.use((req,res)=> res.status(404).render('site/404'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Space Motors listo en http://localhost:'+PORT+', DATA_DIR='+DATA_DIR+', UPLOADS_DIR='+UPLOADS_DIR));
