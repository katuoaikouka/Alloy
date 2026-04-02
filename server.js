const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const sanitizer = require('sanitizer');

const app = express();

// --- 設定 ---
const port = process.env.PORT || 8080;
const listenip = '0.0.0.0';

// --- ミドルウェア ---
app.use(cookieParser());
app.use(session({
    secret: 'alloy-v3-static-secret',
    saveUninitialized: true,
    resave: true,
    cookie: { httpOnly: false }
}));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// 必要なディレクトリの作成
if (!fs.existsSync('public')) fs.mkdirSync('public');
app.use('/alloy/assets', express.static(path.join(__dirname, 'public')));

// --- ユーティリティ ---
const encode = (data) => Buffer.from(data).toString('base64');
const decode = (data) => Buffer.from(data, 'base64').toString('utf-8');

// --- メインプロキシロジック ---
app.all('/fetch/:target/*', async (req, res) => {
    let targetOrigin;
    try {
        targetOrigin = decode(req.params.target);
    } catch (e) {
        return res.status(400).send("Invalid Target");
    }

    const targetPath = req.params ? '/' + req.params : '';
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const targetUrl = targetOrigin + targetPath + query;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    headers['referer'] = targetOrigin;
    headers['user-agent'] = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: headers,
            body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : null,
            redirect: 'manual'
        });

        // リダイレクト処理
        if (.includes(response.status)) {
            let loc = response.headers.get('location');
            if (loc) {
                const absoluteLoc = new URL(loc, targetOrigin).href;
                return res.redirect(307, `/fetch/${encode(new URL(absoluteLoc).origin)}${new URL(absoluteLoc).pathname}${new URL(absoluteLoc).search}`);
            }
        }

        res.status(response.status);
        response.headers.forEach((v, k) => {
            const key = k.toLowerCase();
            if (['content-security-policy', 'x-frame-options', 'content-encoding', 'transfer-encoding'].includes(key)) return;
            if (key === 'set-cookie') {
                const modifiedCookie = v.replace(/Path=\//gi, `Path=/fetch/${req.params.target}/`);
                res.append('set-cookie', modifiedCookie);
            } else {
                res.setHeader(k, v);
            }
        });

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('text/html')) {
            let body = await response.text();
            const originEncoded = req.params.target;
            
            body = body
                .replace(/(href|src|action)="\//gi, `$1="/fetch/${originEncoded}/`)
                .replace(/(href|src|action)='\//gi, `$1='/fetch/${originEncoded}/`)
                .replace('<head>', `<head><script id="alloyData" data-alloyURL="${originEncoded}" src="/alloy/assets/inject.js"></script>`);
            
            res.send(body);
        } else {
            response.body.pipe(res);
        }
    } catch (err) {
        res.status(500).send(`Proxy Error: ${sanitizer.escape(err.message)}`);
    }
});

// --- UI (Index Page) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Alloy Proxy v3</title>
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --accent: #38bdf8; --text: #f1f5f9; }
        body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
        .container { background: var(--card); padding: 2rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); width: 100%; max-width: 450px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
        h1 { margin-bottom: 1.5rem; font-weight: 800; letter-spacing: -0.025em; color: var(--accent); }
        .input-group { position: relative; margin-bottom: 1.5rem; }
        input { width: 100%; padding: 12px 16px; border-radius: 8px; border: 2px solid #334155; background: #0f172a; color: white; box-sizing: border-box; transition: border-color 0.2s; font-size: 1rem; }
        input:focus { outline: none; border-color: var(--accent); }
        button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: var(--accent); color: #0f172a; font-weight: bold; cursor: pointer; transition: transform 0.1s, opacity 0.2s; font-size: 1rem; }
        button:hover { opacity: 0.9; }
        button:active { transform: scale(0.98); }
        .footer { margin-top: 1.5rem; font-size: 0.8rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Alloy Proxy</h1>
        <form action="/createSession" method="POST">
            <div class="input-group">
                <input type="text" name="url" placeholder="https://discord.com" required>
            </div>
            <button type="submit">Launch Proxy</button>
        </form>
        <div class="footer">Enter a URL to browse privately</div>
    </div>
</body>
</html>
    `);
});

app.post('/createSession', (req, res) => {
    let url = req.body.url;
    if (!url) return res.redirect('/');
    if (!url.startsWith('http')) url = 'https://' + url;
    try {
        const urlObj = new URL(url);
        res.redirect(`/fetch/${encode(urlObj.origin)}${urlObj.pathname}`);
    } catch (e) {
        res.status(400).send("Invalid URL format");
    }
});

app.listen(port, listenip, () => {
    console.log(`\x1b[36m%s\x1b[0m`, `[Alloy] Running at http://localhost:${port}`);
});
