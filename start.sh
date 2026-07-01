d#!/bin/bash

echo "🚀 Starting DevHub..."

# Setup & Start Backend
echo "📦 Checking backend dependencies..."
cd devhub-server || exit
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi
echo "🟢 Starting Backend..."
npm run dev &
BACKEND_PID=$!
cd ..

# Setup & Start Frontend
echo "📦 Checking frontend dependencies..."
cd code-haven-ui || exit
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
echo "🟢 Starting Frontend..."
npm run dev &
FRONTEND_PID=$!
cd ..

# Wait for servers to spin up
echo "⏳ Waiting for servers to start..."
sleep 3

# Open browser
echo "🌐 Opening browser..."
if command -v open &> /dev/null; then
    open http://localhost:5173
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5173
fi

echo "✅ Everything is running! Press Ctrl+C in this terminal to stop the servers."

# Trap Ctrl+C to cleanly kill the background processes
cleanup() {
    echo "Stopping servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    # Fallback: force kill any processes still listening on the frontend and backend ports
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    lsof -ti:5173 | xargs kill -9 2>/dev/null
    exit 0
}

trap cleanup INT TERM
wait
