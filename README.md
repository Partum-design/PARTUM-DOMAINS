# Partum Domains

PWA local-first para administrar dominios, vencimientos, clientes, contactos y accesos sensibles.

## Seguridad y persistencia

- La bóveda se cifra en el navegador con Web Crypto: PBKDF2-SHA256 y AES-GCM.
- La información se guarda en IndexedDB y cada cambio se agrega como evento cifrado append-only.
- La app no elimina eventos de historial. Archivar no borra la información.
- El botón de exportar genera un respaldo cifrado portable en JSON.
- La app crea snapshots cifrados automáticos cada 15 días por defecto.
- Si el navegador soporta Periodic Background Sync, intenta crear snapshots aunque no estés viendo la app.
- Si el navegador no lo soporta, el backup se genera al abrir la PWA cuando ya esté vencida la fecha.
- La PWA solicita almacenamiento persistente al navegador para reducir el riesgo de limpieza automática.
- No hay usuario/contraseña hardcodeados en el código. El usuario y la contraseña maestra se crean en el primer inicio.

## Límite importante

Un despliegue estático en Vercel no sincroniza datos entre dispositivos. Cada navegador mantiene su bóveda local cifrada. Los snapshots automáticos viven en el almacenamiento local del navegador; para garantizar disponibilidad fuera de una máquina, descarga/exporta respaldos cifrados con frecuencia.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy a Vercel

```bash
vercel
vercel --prod
```

Vercel debe usar:

- Build command: `npm run build`
- Output directory: `dist`

El archivo `vercel.json` incluye headers restrictivos de seguridad para producción.
