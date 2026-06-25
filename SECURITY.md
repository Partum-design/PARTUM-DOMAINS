# Seguridad

## Modelo de protección

Partum Domains protege los datos sensibles con cifrado local. El servidor estático solo entrega la aplicación; no recibe ni guarda contraseñas de dominios, WordPress, hosting o correos.

## Recomendaciones operativas

- Usa una contraseña maestra larga y única.
- Exporta respaldos cifrados después de cambios importantes.
- Revisa el panel de backups automáticos y descarga copias externas periódicamente.
- Guarda respaldos en al menos dos ubicaciones controladas por Partum.
- No compartas el archivo de respaldo junto con la contraseña maestra.
- Instala la PWA solo en equipos confiables.
- Mantén el navegador y sistema operativo actualizados.

## Qué no promete

Ninguna PWA puede ser literalmente invulnerable. Si un equipo está comprometido, si alguien conoce la contraseña maestra o si se borra el perfil del navegador sin respaldo, el sistema no puede recuperar la bóveda por sí solo.

## Controles incluidos

- Cifrado AES-GCM por registro de historial.
- Derivación PBKDF2-SHA256 con salt único.
- Usuario ligado al secreto de desbloqueo.
- Bloqueo temporal de login tras intentos fallidos.
- Historial append-only.
- Exportación/importación cifrada.
- Snapshots automáticos cifrados con frecuencia configurable.
- Headers CSP, `frame-ancestors 'none'`, `nosniff`, `no-referrer` y Permissions Policy en Vercel.
