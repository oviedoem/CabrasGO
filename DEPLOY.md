# Desplegar CabrasGo en Firebase + Cloud Run (gratis / costo mínimo)

Pensado para correr tal cual en Google Cloud Shell (ya trae `gcloud` y
`firebase` instalados y autenticados con tu cuenta).

- **Frontend** → Firebase Hosting (gratis, capa Spark).
- **Backend** (API + WebSockets) → Cloud Run (capa gratuita: 2 millones de
  requests/mes, se escala a cero cuando nadie lo usa → $0 en uso normal de
  demo).

> Nota: la base de datos es SQLite dentro del contenedor de Cloud Run. Cada
> vez que la instancia arranca en frío (tras un rato sin tráfico) se
> reseedea con los datos demo reales de la VI Región — funcional para una
> demo, pero los viajes que se generen en una sesión no persisten entre
> arranques en frío. Si más adelante se necesita persistencia real,
> el siguiente paso es Cloud SQL (Postgres) o Filestore, documentado en
> `backend/prisma/schema.prisma`.

## 1. Clonar y entrar al proyecto

```bash
git clone https://github.com/oviedoem/CabrasGO.git
cd CabrasGO
```

## 2. Desplegar el backend a Cloud Run

```bash
gcloud run deploy cabrasgo-backend \
  --source backend \
  --region southamerica-west1 \
  --allow-unauthenticated \
  --set-env-vars JWT_SECRET=cabrasgo_secret_token_auth_vi_region

# Guarda la URL que imprime al final (https://cabrasgo-backend-xxxxx.run.app)
BACKEND_URL=$(gcloud run services describe cabrasgo-backend \
  --region southamerica-west1 --format='value(status.url)')
echo "$BACKEND_URL"
```

## 3. Compilar el frontend apuntando a esa URL

```bash
cd frontend
npm install
VITE_API_URL="$BACKEND_URL" npm run build
cd ..
```

## 4. Desplegar el frontend a Firebase Hosting

```bash
firebase deploy --only hosting --project cabrasgo
```

Al terminar, Firebase imprime la URL pública (algo como
`https://cabrasgo.web.app`). Esa es la app — abre `/pasajero`,
`/conductor` o `/admin`.

## Re-desplegar tras un cambio

```bash
# backend
gcloud run deploy cabrasgo-backend --source backend --region southamerica-west1

# frontend (recompilar con la URL del backend y volver a publicar)
cd frontend && VITE_API_URL="$BACKEND_URL" npm run build && cd ..
firebase deploy --only hosting --project cabrasgo
```
