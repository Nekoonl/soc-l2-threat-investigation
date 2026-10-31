"""Bounded, expiring server-side previews for exports. No disk or SQLite writes."""
import copy
import threading
import time
from collections import OrderedDict

TTL_SECONDS = 30 * 60
MAX_PREVIEWS = 4
_entries = OrderedDict()
_lock = threading.RLock()


def remember(preview):
    """Only called after the explicit preview endpoint completed successfully."""
    with _lock:
        now = time.monotonic()
        for key in list(_entries):
            if _entries[key][0] <= now:
                del _entries[key]
        _entries[preview['preview_id']] = (now + TTL_SECONDS, copy.deepcopy(preview))
        _entries.move_to_end(preview['preview_id'])
        while len(_entries) > MAX_PREVIEWS:
            _entries.popitem(last=False)


def resolve(preview_id, revision):
    with _lock:
        entry = _entries.get(preview_id)
        if entry is None or entry[0] <= time.monotonic():
            _entries.pop(preview_id, None)
            raise ValueError('La vista previa no está disponible en este servidor o expiró. Ejecútala manualmente en Incidentes antes de incluir sus resultados.')
        preview = entry[1]
        if preview['dataset'].get('revision') != revision:
            raise ValueError('El dataset cambió desde la vista previa. Actualiza el resumen y ejecuta una nueva vista manual; no se recalculó ningún análisis.')
        return copy.deepcopy(preview)
