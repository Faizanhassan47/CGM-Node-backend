
const dotenv = require('dotenv');

dotenv.config({
    path: '.env.staging',
    override: true,
});

const raw = process.env.DB_CONNECTION_STRING || '';

const settings = Object.fromEntries(
    raw.split(';')
        .filter(Boolean)
        .map((part) => {
            const index = part.indexOf('=');
            return [
                part.slice(0, index).trim().toLowerCase(),
                part.slice(index + 1).trim(),
            ];
        })
);

console.log({
    envLoaded: Boolean(raw),
    host: settings.server,
    port: settings.port,
    database: settings.database,
    username: settings.user,
    passwordPresent: Boolean(settings.password),
    passwordLength: settings.password?.length || 0,
    sslMode: settings.sslmode,
});
