#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Kill any stale processes
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:7474 | xargs kill -9 2>/dev/null

echo "Starting DevHub..."

# Start Backend
cd "$DIR/devhub-server" || exit
if [ ! -f "node_modules/.bin/nodemon" ]; then
    echo "Installing backend dependencies..."
    npm install
fi
echo "Starting Backend..."
npm run dev &
BACKEND_PID=$!

# Start Frontend
cd "$DIR/code-haven-ui" || exit
if [ ! -f "node_modules/.bin/vite" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
echo "Starting Frontend..."
npm run dev &
FRONTEND_PID=$!

echo "Waiting for servers to start..."
sleep 5

echo "Opening browser..."
open http://localhost:7474

echo "DevHub is running! Press Ctrl+C to stop."

cleanup() {
    echo "Stopping servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    lsof -ti:7474 | xargs kill -9 2>/dev/null
    exit 0
}

trap cleanup INT TERM
wait
