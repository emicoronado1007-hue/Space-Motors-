# Deploy de Space Motors (rápido)

## Opción A) Render.com (recomendada)
1. Sube esta carpeta a un repo nuevo en GitHub.
2. En Render, crea "New +", "Blueprint" y pega la URL del repo.
3. Render detectará `render.yaml`. Da Deploy.
4. Espera el build. La app quedará online con URL pública.
   - Admin: /admin (usuario admin, pass en variables)
   - Storage persistente: /data (DB y fotos)

## Opción B) Railway.app
1. Nuevo proyecto -> Deploy from Repo -> selecciona el repo.
2. Variables de entorno:
   - ADMIN_USER=admin
   - ADMIN_PASS=BrendaConor2007
   - WHATSAPP_PHONE=525536343619
   - DATA_DIR=/data
   - UPLOADS_DIR=/data/uploads
3. Crea un volumen "data" y móntalo en /data (1GB).
4. Start command: npm start; Build: npm install && npm run seed

## Opción C) Replit (demo rápido)
1. Crea un Repl de Node.js.
2. Sube todos los archivos.
3. En el Shell: npm install && npm run seed && npm run dev
4. Activa "Always On" o el webview para exponer la URL.

## Local
```
cp .env.example .env
npm install
npm run seed
npm run dev
# abre http://localhost:3000
```
