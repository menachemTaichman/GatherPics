@echo off
echo Starting Face Gallery Development Servers...
echo.

echo Starting Backend Server (Flask)...
start "Backend Server" cmd /k "cd src\backend && python app.py"

echo Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak > nul

echo Starting Frontend Server (Vite)...
start "Frontend Server" cmd /k "npm run dev"

echo.
echo Both servers are starting...
echo Backend: http://localhost:5000
echo Frontend: http://localhost:5173
echo.
echo Press any key to exit this script (servers will continue running)
pause > nul 