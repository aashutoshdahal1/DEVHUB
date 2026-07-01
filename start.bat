@echo off
echo 🚀 Starting DevHub...

echo 📦 Checking backend dependencies...
cd devhub-server
if not exist "node_modules\" (
    echo Installing backend dependencies...
    call npm install
)
echo 🟢 Starting Backend...
start "DevHub Backend" cmd /c "npm run dev"
cd ..

echo 📦 Checking frontend dependencies...
cd code-haven-ui
if not exist "node_modules\" (
    echo Installing frontend dependencies...
    call npm install
)
echo 🟢 Starting Frontend...
start "DevHub Frontend" cmd /c "npm run dev"
cd ..

echo ⏳ Waiting for servers to start...
timeout /t 3 /nobreak >nul

echo 🌐 Opening browser...
start http://localhost:5173

echo ✅ DevHub is running in separate windows. Close those windows to stop the servers.
pause
