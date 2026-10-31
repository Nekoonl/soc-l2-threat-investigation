# Preparación de GitHub y portafolio

Esta guía propone acciones para una etapa posterior, después de revisar y autorizar el contenido. No implica que el repositorio remoto exista ni que se haya publicado el proyecto.

## Presentación propuesta

- **Nombre:** `soc-l2-threat-investigation`.
- **Descripción:** «Plataforma académica SOC L2 local para importar CSV/XLSX, explorar evidencia, ejecutar detecciones verificables y generar informes PDF con React y Python».
- **Topics sugeridos:** `soc`, `cybersecurity`, `incident-response`, `digital-forensics`, `threat-detection`, `react`, `typescript`, `python`, `starlette`, `sqlite`, `reportlab`, `bootcamp-project`.

Evitar etiquetas que sugieran IA operativa, detección autónoma infalible o uso comercial validado. Codex fue un asistente de desarrollo; no es el motor en ejecución.

## Contenido y autorizaciones

Conservar código, manifiestos/lockfile, pruebas, fixtures sintéticos verificados y documentación pública. Los informes internos permanecen localmente en sus rutas, excluidos mediante una lista de excepciones de documentación pública en `.gitignore`.

No incluir bases SQLite, Excel/CSV privados, importaciones, auditorías, capturas sin revisar, PDF con evidencia, perfiles del navegador, secretos ni dependencias instaladas. Las únicas excepciones de datos actuales son el CSV sintético reproducible y los dos PDF sintéticos utilizados por las pruebas frontend. Los JSON de prueba también se revisaron como sintéticos y no contienen filas del Excel privado.

El nombre `powershell.exe`, un código de evento Windows o un término de seguridad pueden aparecer legítimamente en código y fixtures. Su coincidencia con una celda del dataset no prueba que se copió evidencia. Revisar procedencia y contenido, especialmente identificadores, identidades, comandos completos y hashes de archivo.

Antes de publicar, decidir autoría, licencia, autorización de difusión y capturas. No se ha agregado una licencia por defecto. Una copia pública no debe contener referencias rotas a archivos privados como si fueran descargables.

## Comprobación desde una copia sin datos

Seguir la instalación del README en una carpeta nueva. El arranque normal de Uvicorn inicializa un esquema vacío: no es necesario el Excel del Bootcamp, la base del autor ni un secreto. Confirmar JSON tanto en `8000/api/health` como en `5173/api/health` y recorrer las seis pantallas. Antes de importar, Investigaciones/Informes deben expresar su falta de datos y el Resumen no debe inventar hallazgos.

Ejecutar backend, frontend, tipos y build con los comandos del README. No utilizar acciones del prototipo de demostración para poblar la base del autor. Una prueba de instalación con dependencias ya disponibles no acredita una instalación en otro Windows o una descarga futura de paquetes.

## Comandos futuros: revisión local

**No ejecutados como preparación de esta etapa.** Utilizar solamente después de aprobar los archivos, desde la raíz. Si ya existiera un repositorio, inspeccionarlo antes de ejecutar `git init` o configurar un remoto.

```powershell
git init -b main
git status --short --ignored
git add -- .gitignore .gitattributes AGENTS.md README.md requirements.txt run.ps1 app frontend static tests scripts samples docs assets
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check
git diff --cached
git ls-files -ci --exclude-standard
git remote -v
```

El último listado de archivos rastreados pero ignorados debe estar vacío. Revisar que los datos excluidos no estén en el índice; `git diff --check` comprueba formato, no secretos. Revisar manualmente el diff completo y cualquier archivo binario permitido antes del commit. No usar `git add -f`, `git add -A` sin revisión, ni opciones de omisión de `.gitignore`.

Si un archivo privado ya está rastreado o comprometido, detener la publicación. Ignorarlo no lo saca del índice ni del historial. Preparar un plan de retiro del índice/historial y, si contiene credenciales válidas, de revocación; no reescribir historia automáticamente.

Tras revisar también la identidad de autor configurada:

```powershell
git config --get user.name
git config --get user.email
git commit -m "Prepare academic SOC L2 platform for review"
git log --all --oneline
git ls-tree -r --name-only HEAD
```

Configurar la identidad propia si falta, sin copiar la de otra persona ni guardar tokens en el código. Para privacidad, puede utilizarse el correo de commit que el propietario haya elegido en su cuenta.

## Comandos futuros: remoto y envío

**Requieren la autorización posterior del usuario. No se ejecutaron.** Si ya se dispone de GitHub CLI autenticado, este ejemplo crea primero un remoto **privado**, sin enviar commits:

```powershell
$GitHubOwner = 'TU_USUARIO'
gh repo create "$GitHubOwner/soc-l2-threat-investigation" --private --source . --remote origin
git remote -v
```

Si GitHub CLI no está instalado, no hace falta instalarlo para usar el proyecto: se puede crear posteriormente un repositorio privado vacío desde GitHub, sin archivos iniciales, y configurar su URL:

```powershell
$GitHubOwner = 'TU_USUARIO'
git remote add origin "https://github.com/$GitHubOwner/soc-l2-threat-investigation.git"
git remote -v
```

Elegir **una** de las alternativas para crear `origin`, verificar propietario y URL y revisar de nuevo el commit. Después de la aprobación final del envío:

```powershell
git push -u origin main
```

No introducir tokens en la URL ni cambiar automáticamente la visibilidad a pública. La publicación pública, el envío de evidencia, el cambio de visibilidad y una eventual licencia requieren decisiones del propietario. Un repositorio privado tampoco justifica subir secretos o evidencia no autorizada.

## Guion sugerido de portafolio

Mostrar alcance académico, arranque local, métricas de un dataset autorizado, búsqueda y procedencia, vista previa manual estricta y PDF con/sin evaluación. Explicar las reglas omitidas, la limitación temporal y la diferencia entre severidad original y prioridad. Identificar cualquier dataset de laboratorio como sintético.

Capturas pendientes: Resumen, Eventos, Investigaciones e Informes, con los nombres y controles de privacidad de [esta guía de capturas](../assets/screenshots/README.md). No subir automáticamente los informes privados usados en QA. Contrastar la rúbrica final del Bootcamp antes de afirmar cumplimiento completo.
