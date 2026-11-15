@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0.."
set "IMAGE_NAME=pm-app:latest"
set "CONTAINER_NAME=pm-app"

docker build --tag "%IMAGE_NAME%" .
if errorlevel 1 exit /b !errorlevel!

docker container inspect "%CONTAINER_NAME%" >nul 2>&1
if not errorlevel 1 (
    set "CONTAINER_RUNNING=false"
    for /f %%S in ('docker container inspect --format "{{.State.Running}}" "%CONTAINER_NAME%"') do set "CONTAINER_RUNNING=%%S"
    if /i "!CONTAINER_RUNNING!"=="true" (
        docker stop "%CONTAINER_NAME%"
        if errorlevel 1 exit /b !errorlevel!
    )
    docker rm "%CONTAINER_NAME%"
    if errorlevel 1 exit /b !errorlevel!
)

docker run --detach --name "%CONTAINER_NAME%" --publish 127.0.0.1:8000:8000 --volume pm-data:/app/data "%IMAGE_NAME%"
if errorlevel 1 exit /b !errorlevel!

for /l %%i in (1,1,30) do (
    curl.exe --fail --silent --output NUL http://127.0.0.1:8000/api/health >nul 2>&1
    if not errorlevel 1 goto ready
    timeout /t 1 /nobreak >nul
)

echo Project Management app did not become ready within 30 seconds.
docker logs "%CONTAINER_NAME%"
exit /b 1

:ready
echo Project Management app is available at http://localhost:8000
