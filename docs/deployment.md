# Self-hosting Prism

This guide deploys the Prism web app and API with Docker Compose. Redis stores API sessions and queue data. Nginx provides a public HTTPS endpoint; the containers themselves bind to loopback ports.

## Requirements

- Docker Engine with the Compose plugin
- A Linux host with ports 80 and 443 available
- A DNS name pointing to that host for a public TLS certificate

## Configure and start

Clone the repository and create an environment file:

```sh
git clone https://github.com/DevNiola/Prism.git
cd Prism
cp .env.example .env
```

Replace `prism.example.com` in `.env` with your domain. The template contains these settings:

```dotenv
NEXT_PUBLIC_API_URL=https://prism.example.com
REDIS_URL=redis://redis:6379
AI_API_KEY=
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_MAX_TOKENS_PER_REQUEST=2048
AI_TEMPERATURE=0.2
AI_TIMEOUT_MS=30000
AI_HOURLY_TOKEN_LIMIT=100000
AI_DAILY_TOKEN_LIMIT=1000000
AI_MAX_CONCURRENT=5

# Cache and deduplication settings, in seconds and milliseconds respectively.
CACHE_DECODE_TTL=86400
CACHE_PROFILE_TTL=3600
DEDUP_WINDOW_MS=10000
```

`NEXT_PUBLIC_API_URL` is compiled into the web app at image-build time, so set it to the public origin before building. `REDIS_URL` is the API's Redis connection string. `AI_API_KEY` is optional; leaving it blank disables AI explanations. `AI_API_BASE_URL` and `AI_MODEL` select the compatible provider endpoint and model. `AI_MAX_TOKENS_PER_REQUEST`, `AI_TEMPERATURE`, and `AI_TIMEOUT_MS` control individual AI requests. `AI_HOURLY_TOKEN_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, and `AI_MAX_CONCURRENT` set usage limits. `CACHE_DECODE_TTL` and `CACHE_PROFILE_TTL` are cache durations in seconds; `DEDUP_WINDOW_MS` is a deduplication window in milliseconds. The API listens on port 3001 in the container. Do not commit `.env`; it contains deployment secrets.

Build and start the stack:

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3001/health
```

The app is available on `127.0.0.1:3000`. The API is available on `127.0.0.1:3001`. Neither port is exposed to other hosts; nginx on the same machine can reach both. For local development, set `NEXT_PUBLIC_API_URL=http://localhost:3001` before building.

## Redis

Compose starts Redis 7 with append-only persistence in the named `redis-data` volume and waits for its health check before starting the API. The API and Redis communicate over the private Compose network using `REDIS_URL=redis://redis:6379`. Do not publish Redis port 6379 to the internet. Back up the `redis-data` volume if session and queue durability is important; sessions expire after one hour.

For a Redis instance with authentication, supply its complete connection URL through `REDIS_URL`, for example `rediss://:password@redis.example.net:6380`. URL-encode reserved characters in credentials. The Compose Redis service is intended for a single-host deployment; use a managed or separately operated Redis service when you need high availability.

## Nginx reverse proxy

Install nginx on the Docker host and create `/etc/nginx/sites-available/prism` (replace the domain):

```nginx
server {
    listen 80;
    server_name prism.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
}
```

Enable the site and check the configuration:

```sh
sudo ln -s /etc/nginx/sites-available/prism /etc/nginx/sites-enabled/prism
sudo nginx -t
sudo systemctl reload nginx
```

The `/api/` route must preserve the URI when proxying. `proxy_pass` has no trailing path component for that reason.

## SSL/TLS

Point the domain's DNS A/AAAA records at the host, allow inbound TCP ports 80 and 443, and install Certbot with its nginx plugin. Then request and install a certificate:

```sh
sudo certbot --nginx -d prism.example.com
```

Certbot updates the nginx server block to listen on HTTPS and redirects HTTP to HTTPS. Verify renewal with:

```sh
sudo certbot renew --dry-run
```

After HTTPS is active, confirm `.env` has `NEXT_PUBLIC_API_URL=https://prism.example.com`, then rebuild the web image and check the deployed site:

```sh
docker compose up -d --build web
curl -I https://prism.example.com
```

## Updating and troubleshooting

Pull the desired source revision and rebuild:

```sh
git pull
docker compose up -d --build
docker compose logs -f server web redis
```

If the API does not become healthy, verify the Redis URL and inspect `docker compose logs server redis`. The web app's API URL is baked into its build; rebuild the web service after changing `NEXT_PUBLIC_API_URL`.