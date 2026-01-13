## Stockfish engine files (optional local vendor)

This chess page (`web/chess/`) loads Stockfish in the browser via a WebWorker.

The code **prefers a local worker first**:

- `./engine/stockfish.worker.js`

and falls back to the CDN worker:

- `stockfish.wasm@0.10.0` via `cdn.jsdelivr.net`

### To vendor locally (recommended for Telegram WebView)

Place these files into this folder:

- `stockfish.worker.js`
- `stockfish.js`
- `stockfish.wasm`

If the local files are missing, the app will still work via CDN (or via the heuristic fallback AI if workers are blocked).

