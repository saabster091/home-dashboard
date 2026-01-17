require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const POWERWALL_HOST = process.env.POWERWALL_HOST;
const POWERWALL_EMAIL = process.env.POWERWALL_EMAIL;
const POWERWALL_PASSWORD = process.env.POWERWALL_PASSWORD;

let authToken = null;

async function powerwallRequest(endpoint) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: POWERWALL_HOST,
            port: 443,
            path: endpoint,
            method: 'GET',
            rejectUnauthorized: false,
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function authenticate() {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            username: 'customer',
            email: POWERWALL_EMAIL,
            password: POWERWALL_PASSWORD
        });

        const options = {
            hostname: POWERWALL_HOST,
            port: 443,
            path: '/api/login/Basic',
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.token) {
                        authToken = json.token;
                        resolve(true);
                    } else {
                        reject(new Error('No token in response'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function getBatteryLevel() {
    let response = await powerwallRequest('/api/system_status/soe');

    if (response.status === 403) {
        await authenticate();
        response = await powerwallRequest('/api/system_status/soe');
    }

    return response.data;
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/api/battery') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const data = await getBatteryLevel();
            res.writeHead(200);
            res.end(JSON.stringify(data));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    } else if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
});
