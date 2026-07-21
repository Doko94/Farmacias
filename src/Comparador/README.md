# FarmaAhorro

Comparador informativo de medicamentos basado en los CSV generados por los
scrapers de Ahumada, Cruz Verde, Salcobrand, Dr. Simi y Farmacia Municipal de Iquique.

## Funcionalidades

- búsqueda por nombre, marca o principio activo;
- historial detallado mediante snapshots en SQLite;
- alertas por precio objetivo;
- cálculo mensual de tratamientos;
- optimización de recetas entre varias farmacias;
- comparación de bioequivalentes;
- precio Fonasa cuando la farmacia lo publica en la ficha;
- stock exacto cuando la fuente informa unidades y disponibilidad en los demás casos;
- extracción de recetas PDF/foto;
- API FastAPI y dashboard web responsivo.
- mapa de farmacias de turno con información oficial de FARMANET/MINSAL;

## Ejecutar el backend

```powershell
cd src/Comparador/backend
pip install -r requirements.txt
python run.py
```

Documentación interactiva: `http://localhost:8000/docs`.

La primera carga lee los CSV de `src/Scraper`. Para guardar un snapshot del
historial ejecuta `POST /api/catalog/reload` después de cada corrida de los
scrapers. Programa ese endpoint o un comando equivalente después de actualizar
los CSV.

Para OCR de fotografías, además de `pytesseract`, debe instalarse Tesseract OCR
en el servidor con el paquete de idioma español. El usuario siempre debe
confirmar el texto detectado antes de cotizar.

## Frontend local

Abre `frontend/index.html` o sirve la carpeta:

```powershell
python -m http.server 8080 --directory frontend
```

La URL predeterminada del backend es `http://localhost:8000`. Para cambiarla:

```javascript
localStorage.setItem('farma_api', 'https://tu-api.example.com')
```

Sin backend, la página consulta el catálogo JSON generado desde todos los CSV configurados.

## Netlify

Selecciona `src/Comparador` como directorio base. `netlify.toml` publica la
carpeta `frontend`. Netlify aloja el frontend; despliega FastAPI en un servicio
Python y configura su URL con `farma_api`.

La ruta `farmacias-turno.html` consume `/.netlify/functions/farmacias-turno`.
La función normaliza y almacena temporalmente la respuesta pública de FARMANET;
el mapa se muestra con Leaflet y OpenStreetMap, sin una clave de Google Maps.

Los campos enriquecidos de Ahumada (Fonasa, bioequivalencia y disponibilidad)
se incorporan al volver a ejecutar `src/Scraper/Ahumada/ahumada_scraper.py` y
desplegar nuevamente el comparador. Nunca se estima un precio Fonasa ni una
cantidad de stock cuando la farmacia no entrega ese dato.

## Seguridad y alcance

El sistema es informativo: no diagnostica, prescribe ni modifica tratamientos.
Las recetas contienen datos sensibles; en producción usa almacenamiento cifrado,
eliminación automática, consentimiento explícito y una política de privacidad.
Nunca expongas una receta médica en logs.
