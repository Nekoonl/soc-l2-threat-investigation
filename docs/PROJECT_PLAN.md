# Plan del proyecto SOC L2

Proyecto académico del Bootcamp Analista SOC Nivel 2 de Comunidad DOJO y WoSEC Panamá.

## Decisiones permanentes

Aplicación local para Windows. Frontend React + TypeScript + Vite + Tailwind CSS, iconos Lucide y Recharts para visualizaciones posteriores. Backend temporal Starlette; objetivo futuro FastAPI + Pandas. SQLite y los servicios Python existentes se conservan.

Codex asiste al desarrollo. La IA en tiempo de ejecución queda **pendiente de definición y autorización** para evaluar el cumplimiento completo del Bootcamp; no se instala ni integra Ollama, Qwen u otro modelo. Las reglas y la correlación son un motor determinista, no IA generativa.

## Las cinco etapas

| Etapa | Alcance | Criterio de salida |
| --- | --- | --- |
| 1. Preparación | Inspección del entorno, diagnóstico, conservación del prototipo, reglas permanentes y arquitectura. | Entorno identificado, trabajo protegido y alcance acordado. |
| 2. Frontend | React/TypeScript, identidad Enterprise Dark, componentes reutilizables y seis pantallas navegables. Consulta GET del estado del backend. | Interfaz revisable en localhost; build, tipos y navegación comprobados o limitaciones documentadas. Detenerse para revisión visual. |
| 3. Motor SOC e integración de datos | Revisar los módulos conservados, definir contratos, planificar FastAPI/Pandas e integrar importación, eventos y alertas basados en evidencia. IA durante la ejecución: pendiente, fuera del alcance actual. | Trazabilidad verificable desde cada hallazgo hasta el evento fuente, con distinción entre alerta e incidente confirmado. |
| 4. Dashboard, informes y pruebas | Conectar visualizaciones Recharts a datasets reales y los generadores PDF existentes. Ampliar pruebas de integración, accesibilidad, rendimiento y errores. | Estadísticas e informes reproducibles con evidencia real y limitaciones explícitas. |
| 5. Entrega | Documentación técnica y ejecutiva, guía de instalación Windows, demostración y preparación de la presentación. | Proyecto reproducible y revisión del cumplimiento de los requisitos del Bootcamp, incluida la situación de la IA pendiente. |

## Alcance autorizado de la etapa 2

- Crear `frontend/` sin modificar `app/`, `static/`, `tests/`, `.venv`, los generadores PDF ni el motor SOC.
- Dashboard: KPI sin valores inventados, espacios vacíos de gráficos y estado de integración del dataset.
- Eventos: búsqueda y filtros locales preparados, tabla vacía y paginación sin páginas ficticias.
- Incidentes: panel de investigaciones y vistas de evidencias, correlación y notas sin análisis simulado.
- Importación: selección local CSV/XLSX y validación básica de extensión y tamaño; sin lectura del contenido, envío ni análisis.
- Informes: presentar el alcance futuro de los documentos técnico y ejecutivo, sin generar ni alterar PDF.
- Configuración: información de la aplicación y consulta real `GET /api/health`, mediante proxy de Vite hacia `127.0.0.1:8000`.
- Sin autenticación, datos demo, estadísticas precargadas, IA ni otras acciones de backend.

## Conservación del trabajo

### Etapa 3A autorizada: importación y eventos

Tras la confirmación del funcionamiento local de React y Starlette, se conectan únicamente importación y exploración. Se mantiene Starlette; no se migra a FastAPI en esta etapa. El detalle técnico, los endpoints y las comprobaciones están en `docs/STAGE3A_IMPORT_EVENTS.md`.

- Subida CSV/XLSX solo tras el clic explícito; mapeo automático del esquema oficial del Bootcamp.
- Almacenamiento aditivo en SQLite: archivo original, SHA-256, Log_ID, valores originales y ocurrencias, incluidas las duplicadas.
- Sin zona horaria implícita en la API de carga. Fechas sin offset se conservan sin zona, salvo declaración explícita del usuario.
- Consulta real de eventos con filtros, búsqueda, paginación y detalle de procedencia.
- Sin ejecutar o cambiar reglas SOC durante la carga; sin cambios en PDF, modelos de IA ni rediseño del dashboard o de la navegación.
- Las restricciones de la etapa 2 descritas arriba documentan su alcance histórico; la autorización 3A habilita ahora los endpoints de importación y eventos.

El prototipo permanece en `static/`; el backend funcional, en `app/`; las 18 pruebas originales, en `tests/`. Los archivos sintéticos de `samples/` y `scripts/` se conservan como material heredado de pruebas y no se cargan desde el nuevo frontend. El código legado de IA permanece sin uso por la nueva interfaz.

La migración posterior aprovechará importación, normalización, almacenamiento, detección, correlación e informes sin asumir que están validados con logs reales. Los identificadores actuales llamados `incidents` requieren revisar su semántica antes de presentarlos como casos confirmados.

## Validación y dependencias

Usar las dependencias declaradas en `frontend/package.json`. Si la red impide instalarlas, mantener las tecnologías elegidas, registrar el fallo y proporcionar `npm install` para ejecutar manualmente en PowerShell. No declarar un build ni una prueba como aprobados si no pudieron ejecutarse. La evidencia de esta sesión se registra en `docs/FRONTEND_STAGE2_VALIDATION.md`.
