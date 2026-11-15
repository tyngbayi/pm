@echo off
setlocal EnableDelayedExpansion

set "CONTAINER_NAME=pm-app"
docker container inspect "%CONTAINER_NAME%" >nul 2>&1
if errorlevel 1 (
    echo Project Management app container does not exist.
    exit /b 0
)

set "CONTAINER_RUNNING=false"
for /f %%S in ('docker container inspect --format "{{.State.Running}}" "%CONTAINER_NAME%"') do set "CONTAINER_RUNNING=%%S"
if /i "!CONTAINER_RUNNING!"=="true" (
    docker stop "%CONTAINER_NAME%"
    if errorlevel 1 exit /b !errorlevel!
)

docker rm "%CONTAINER_NAME%"
if errorlevel 1 exit /b !errorlevel!
