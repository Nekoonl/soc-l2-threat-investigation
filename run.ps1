param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$PythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $PythonPath)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible crear el entorno virtual.' }
    & $PythonPath -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'No fue posible instalar las dependencias.' }
}
Write-Host "SOC L2 | Threat Investigation Platform: http://127.0.0.1:$Port" -ForegroundColor Green
& $PythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $Port
