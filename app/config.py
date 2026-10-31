import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get('SOC_DATA_DIR', str(ROOT / 'data')))
DATABASE = DATA_DIR / 'soc.db'
TIMEZONE = os.environ.get('SOC_TIMEZONE', 'America/Panama')
MAX_UPLOAD = 10 * 1024 * 1024
MAX_ROWS = 30_000
OLLAMA_MODEL = os.environ.get('SOC_OLLAMA_MODEL', '').strip()
# Loopback is intentional: imported evidence is sent only to the local Ollama service.
OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
