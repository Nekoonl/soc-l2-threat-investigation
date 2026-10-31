# SOC L2 | Threat Investigation Platform

## Alcance y forma de trabajo

- Aplicación exclusivamente local en Windows, mediante localhost. Sin hosting, dominios ni despliegues externos.
- Responder y explicar los avances en español. Trabajar por etapas; detenerse al completar el alcance autorizado para revisión del usuario.
- Leer los archivos antes de modificarlos. Conservar `.venv`, el prototipo en `static/`, los módulos en `app/` y las 18 pruebas originales en `tests/`.
- No borrar, sobrescribir ni mover el prototipo para crear una nueva interfaz. No cambiar de tecnología por un fallo de instalación: explicar el error y proporcionar el comando manual para PowerShell.
- Etapa 2: desarrollar solo el frontend y la consulta del estado del backend. No modificar el motor SOC, las reglas, la correlación ni los PDF. No conectar cargas o acciones de análisis sin autorización para la siguiente etapa.
- Etapa 3A autorizada: conectar importación CSV/XLSX y exploración de SQLite con Starlette. Conservar reglas SOC, PDF, dashboard y navegación. Enviar archivos solo al pulsar Importar; no ejecutar detecciones durante esta carga. Conservar Log_ID, datos originales y procedencia; no asignar zona horaria si no está documentada o declarada explícitamente.
- Etapa 3A.1: auditar inicialmente SQLite en modo de solo lectura; distinguir campos originales, normalizados y presentados. Recuperar valores conservados mediante vistas de lectura, sin reimportar ni reparar datos persistidos automáticamente. Toda migración de registros existentes requiere explicar su necesidad y obtener autorización explícita. Un hash registrado sin el archivo original no acredita su autenticidad.
- Etapa 3A.2: verificar el Excel sin modificarlo ni reimportarlo. Las ventanas SOC deben usar evidencia temporal de origen: UTC solo con offset o declaración documentada. Los intervalos sin zona requieren un ámbito explícito de eventos y un supuesto de reloj comparable, sin mezclarlos con UTC. No activar el motor sobre la base del usuario ni reemplazar incidentes a partir de un dataset temporalmente incompleto.
- Etapa 3B autorizada: conectar las cinco reglas existentes mediante una vista previa reproducible y de solo lectura, iniciada explícitamente. No persistir alertas, auditoría, notas ni resultados en SQLite; usar `mode=ro` y `query_only`. Mantener desactivada por defecto la hipótesis de relojes comparables y marcar alertas/relaciones que dependan de ella. No ejecutar recálculos al abrir pantallas, importar o iniciar servicios. Conservar los casos previos y distinguir alerta, hipótesis y validación del analista.
- Etapa 4A autorizada: Dashboard con agregaciones de origen de solo lectura y gráficos sin supuestos temporales. Contar alertas únicamente de una vista previa realmente ejecutada en la sesión y con la misma revisión del dataset; invalidar caché ante cargas o revisiones diferentes. No inferir confirmación a partir de casos heredados ni de su estado. La navegación puede reutilizar estado React sin peticiones nuevas. Mantener reglas, PDF, autenticación e IA fuera de esta etapa.
- Etapa 4B autorizada: integrar los PDF técnico y ejecutivo mediante ReportLab y los endpoints existentes. Generar solo por acción explícita y en memoria, sin guardar archivos ni escribir auditoría o resultados en SQLite. Exportar originales y su procedencia, sin usar los casos heredados como confirmaciones ni las horas normalizadas históricas como UTC verificadas. Sin vista previa seleccionada, indicar «Detecciones no evaluadas». Incluir alertas solo recuperando una ejecución conservada por el servidor y verificando la revisión del dataset; no aceptar hallazgos del navegador ni recalcular al exportar. Referencias vencidas o incompatibles producen un error, sin omitir alertas silenciosamente. Conservar la hipótesis temporal desactivada por defecto, escapar evidencia no confiable y documentar las comprobaciones PDF estructurales y visuales por separado.

- Etapa 4C.1 autorizada: estabilizar comunicación comparando HTTP directo y proxy, sin asumir que un error de formato significa caída del backend. Conservar rutas permitidas, Host/Origin y localhost; devolver JSON con estado HTTP explícito ante errores de conexión del proxy. Compartir transporte entre salud y datos, conservando validadores de esquema y errores de HTML, redirección y HTTP. Validar sin escrituras ni recálculos persistentes. Documentar la propuesta visual de 4C.2 sin implementarla; distinguir pruebas HTTP/DOM de revisión visual en navegador.

- Etapa 4C.2 autorizada: refinar solo presentación y usabilidad de las seis pantallas. Mantener Enterprise Dark, fuente local, legibilidad, rutas existentes y componentes reutilizables. Menú: Resumen, Eventos, Investigaciones, Importar registros, Informes y Configuración; contracción accesible en escritorio y diálogo móvil. Mantener advertencias relevantes visibles y metodología extensa en ayuda contextual. No modificar API, reglas, PDF, datos ni investigaciones. Comprobar pruebas, teclado y contraste básico; declarar las limitaciones de inspección visual real.

- Etapa 4C.3 autorizada: auditar funcionamiento integral y corregir únicamente defectos confirmados, conservando el diseño aprobado. Comparar las 715 filas y doce columnas con el Excel mediante el auditor de solo lectura y contrastar hashes lógicos de todas las tablas antes/después. Verificar HTTP directo/proxy, errores, búsqueda, métricas, vista previa manual estricta y PDF con/sin selección, sin reimportar ni persistir resultados. Las alertas del ejecutivo deben distinguirse mediante referencias existentes del servidor y eventos originales. Separar revisión visual de PDF, pruebas DOM y revisión real de navegador. Documentar límites, pendientes clasificados y preparación de etapa 5 sin publicar ni afirmar cumplimiento de una rúbrica no disponible.

- Etapa 5A autorizada: preparar GitHub/portafolio sin crear remotos, commits de publicación ni hacer push. Revisar Git y contenido antes de excluirlo; conservar informes internos, base y archivos originales en sus ubicaciones. Mantener una lista explícita de documentación pública en `.gitignore`; no publicar el README histórico del frontend ni auditorías con evidencia. Permitir únicamente fixtures sintéticos revisados y mantener las capturas excluidas hasta su aprobación individual. Probar una copia de las fuentes publicables sin dataset privado, distinguir dependencias reutilizadas/instaladas y documentar fallos de instalación o arranque sin cambiar tecnologías/protecciones. La metadata Git auxiliar de QA debe permanecer bajo `artifacts/`, sin inicializar el repositorio raíz ni contactar servicios externos durante esta preparación.

## Arquitectura

- Frontend separado en `frontend/`: React, TypeScript, Vite, Tailwind CSS, Lucide React y Recharts para futuras visualizaciones de datos reales.
- Backend temporal: Python + Starlette + Uvicorn en `app/`. Arquitectura objetivo: FastAPI + Pandas. La migración requiere una etapa autorizada; no sustituir el backend durante la fase visual.
- Componentes reutilizables, páginas separadas y acceso a la API centralizado y tipado. Evitar componentes monolíticos, duplicación y dependencias innecesarias.
- Configurar los servidores en `127.0.0.1`. Usar un proxy de desarrollo para los endpoints explícitamente conectados; no debilitar CORS, validación de hosts u otras protecciones.

## Evidencia y semántica SOC

- No inventar estadísticas, detecciones, usuarios, IP, activos ni incidentes como resultados reales. Los datos sintéticos heredados quedan como material de prueba; no conectarlos a la nueva interfaz.
- Sin dataset conectado, mostrar estados vacíos y métricas no disponibles (`—`), sin afirmar que hay cero eventos reales.
- Una alerta no equivale a un incidente confirmado. Separar señal, hipótesis, investigación y confirmación del analista.
- Toda conclusión debe vincularse con evidencias verificables, su procedencia, regla y ventana temporal. Los puntajes heurísticos no son probabilidades de compromiso.
- Las funciones pendientes deben estar identificadas y no producir mensajes de éxito ni aparentar operaciones realizadas.

## IA

- Codex es el asistente de desarrollo, revisión y depuración; no es el motor de análisis de la aplicación.
- No instalar, integrar ni llamar a Ollama, Qwen u otros modelos durante las etapas actuales.
- Documentar la IA en tiempo de ejecución como funcionalidad pendiente de definición para el Bootcamp. No presentar reglas deterministas como IA generativa.
- Conservar el código legado que exista sin exponerlo desde la nueva interfaz ni ampliarlo.

## Diseño y accesibilidad

- Enterprise Dark sobrio: fondo `#0B1220`, paneles `#162235`, bordes `#26364B`, texto `#E8EEF5`, interacción azul `#3B82F6`, acento turquesa `#18A999`.
- Sidebar fijo en escritorio, barra superior, navegación responsive, jerarquía tipográfica clara, tablas y espacios para gráficos. Sin neón, degradados excesivos ni adornos innecesarios.
- Interfaz y mensajes en español; iconos Lucide consistentes. Estados de carga, vacío, error, desconexión y función pendiente explícitos.
- HTML semántico, etiquetas de formularios, botones con nombres accesibles, foco visible, navegación por teclado y respeto de movimiento reducido.
- No crear una autenticación visual que pretenda proteger datos. Evaluar el acceso local cuando sea parte del alcance.

## Seguridad y calidad

- No desactivar protecciones de Windows, ejecutar como administrador para eludir restricciones ni exponer servicios a la red.
- No hardcodear credenciales, guardar secretos en Git ni poner secretos en variables `VITE_*`. No añadir recursos externos innecesarios al runtime.
- Tratar los logs como contenido no confiable. No ejecutar comandos ni interpretar HTML de la evidencia. No leer o enviar archivos seleccionados si la pantalla solo prepara la integración.
- Ejecutar las pruebas existentes del backend, el chequeo TypeScript, el build y las pruebas de navegación pertinentes. No modificar las pruebas originales para ocultar fallos.
- Declarar exactamente qué se comprobó, qué falló y qué no pudo ejecutarse. Un chequeo de sintaxis no sustituye al build o a una prueba en navegador.
- Documentar instalación, ejecución, arquitectura, funciones conectadas y pendientes en `docs/` y `frontend/README.md`.
