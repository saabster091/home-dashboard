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

async function getWithAuth(endpoint) {
    if (!authToken) {
        await authenticate();
    }

    let response = await powerwallRequest(endpoint);

    if (response.status === 403 || response.status === 401) {
        authToken = null;
        await authenticate();
        response = await powerwallRequest(endpoint);
    }

    return response.data;
}

// Proactively refresh token every 30 minutes
async function refreshToken() {
    try {
        await authenticate();
        console.log('Token refreshed at', new Date().toLocaleString());
    } catch (error) {
        console.error('Token refresh failed:', error.message);
    }
}

// Initial auth and schedule refresh
refreshToken();
setInterval(refreshToken, 30 * 60 * 1000);

async function getPowerData() {
    const [soe, meters] = await Promise.all([
        getWithAuth('/api/system_status/soe'),
        getWithAuth('/api/meters/aggregates')
    ]);

    return {
        percentage: soe.percentage,
        solar: meters.solar?.instant_power || 0,
        load: meters.load?.instant_power || 0,
        battery: meters.battery?.instant_power || 0,
        grid: meters.site?.instant_power || 0
    };
}

const WEATHER_CODES = {
    0: { description: 'Clear sky', icon: '☀️' },
    1: { description: 'Mainly clear', icon: '🌤️' },
    2: { description: 'Partly cloudy', icon: '⛅' },
    3: { description: 'Overcast', icon: '☁️' },
    45: { description: 'Foggy', icon: '🌫️' },
    48: { description: 'Rime fog', icon: '🌫️' },
    51: { description: 'Light drizzle', icon: '🌧️' },
    53: { description: 'Drizzle', icon: '🌧️' },
    55: { description: 'Dense drizzle', icon: '🌧️' },
    61: { description: 'Slight rain', icon: '🌧️' },
    63: { description: 'Rain', icon: '🌧️' },
    65: { description: 'Heavy rain', icon: '🌧️' },
    71: { description: 'Slight snow', icon: '🌨️' },
    73: { description: 'Snow', icon: '🌨️' },
    75: { description: 'Heavy snow', icon: '🌨️' },
    80: { description: 'Slight showers', icon: '🌦️' },
    81: { description: 'Showers', icon: '🌦️' },
    82: { description: 'Heavy showers', icon: '🌦️' },
    95: { description: 'Thunderstorm', icon: '⛈️' },
    96: { description: 'Thunderstorm with hail', icon: '⛈️' },
    99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' }
};

async function getWeather() {
    return new Promise((resolve, reject) => {
        const url = '/v1/forecast?latitude=-35.2833&longitude=138.4667&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&timezone=Australia/Adelaide';
        const options = {
            hostname: 'api.open-meteo.com',
            port: 443,
            path: url,
            method: 'GET'
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const current = json.current;
                    const weatherInfo = WEATHER_CODES[current.weather_code] || { description: 'Unknown', icon: '❓' };
                    resolve({
                        temperature: current.temperature_2m,
                        feelsLike: current.apparent_temperature,
                        humidity: current.relative_humidity_2m,
                        windSpeed: current.wind_speed_10m,
                        windDirection: current.wind_direction_10m,
                        description: weatherInfo.description,
                        icon: weatherInfo.icon
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

const SERVICES = [
    { id: 'home', name: 'Home Assistant', url: 'http://192.168.1.210:8123' },
    { id: 'movies', name: 'Jellyfin', url: 'http://192.168.1.210:8096' },
    { id: 'ai', name: 'Open WebUI', url: 'http://192.168.1.210:8081' },
    { id: 'grafana', name: 'Grafana', url: 'http://192.168.1.210:9000' },
    { id: 'pihole', name: 'Pi-hole', url: 'http://192.168.1.210:8888' },
    { id: 'solar', name: 'Solar', url: 'http://192.168.1.210:8675' },
    { id: 'admin', name: 'NPM Admin', url: 'http://192.168.1.210:81' }
];

function checkService(url) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 3000);

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: 'GET',
            timeout: 3000
        };

        const req = http.request(options, (res) => {
            clearTimeout(timeout);
            resolve(res.statusCode < 500);
        });

        req.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

async function getServicesHealth() {
    const results = await Promise.all(
        SERVICES.map(async (service) => ({
            id: service.id,
            name: service.name,
            healthy: await checkService(service.url)
        }))
    );
    return results;
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/api/power') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const data = await getPowerData();
            res.writeHead(200);
            res.end(JSON.stringify(data));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    } else if (req.url === '/api/health') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const data = await getServicesHealth();
            res.writeHead(200);
            res.end(JSON.stringify(data));
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    } else if (req.url === '/api/weather') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const data = await getWeather();
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
