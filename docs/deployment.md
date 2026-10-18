# Self-Hosting Deployment Guide for Prism

This comprehensive guide walks you through deploying and operating Prism on your own infrastructure. Whether you are running on a bare-metal Linux server, a cloud VPS (AWS EC2, DigitalOcean Droplet, Hetzner, GCP Compute Engine), or an on-premise cluster, this documentation covers Docker orchestration, Redis setup, Nginx reverse proxy configuration, SSL/TLS certificates, environment variables, and maintenance.

---

## Architecture Overview

A self-hosted Prism installation consists of four core components:

```
                           Internet / Clients
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │    Nginx (SSL/TLS Reverse     │
                   │    Proxy & WebSocket Gateway) │
                   └───────────────┬───────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
                ▼                                     ▼
      Path: /api, /ws, /health                     Path: /
    ┌───────────────────────┐             ┌─────────────────────┐
    │  Prism API Server     │             │  Prism Web UI       │
    │  (Fastify / Port 3001)│             │  (Next.js / Port 3000)
    └───────────┬───────────┘             └─────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │     Redis Server      │
    │  (Port 6379, AOF ON)  │
    └───────────────────────┘
```

1. **Prism Web UI (`apps/web`)**: Next.js frontend serving the trace analysis dashboard, interactive simulation, and error decoding interface on port `3000`.
2. **Prism API Server (`apps/server`)**: Fastify backend performing contract execution replay, diagnostic decoding, token budgeting, and real-time WebSocket trace streaming on port `3001`.
3. **Redis Store**: Persistent cache, task queue (BullMQ), and distributed deduplication lock engine on port `6379`.
4. **Nginx Reverse Proxy**: Single ingress termination point handling HTTPS (port 443), HTTP-to-HTTPS redirect (port 80), path routing, and WebSocket upgrades.

---

## Hardware & System Requirements

### Minimum Requirements (Development / Small Teams)
- **CPU:** 2 vCPU cores
- **RAM:** 4 GB RAM
- **Disk:** 20 GB SSD storage
- **OS:** Ubuntu 22.04 LTS / 24.04 LTS, Debian 12, or AlmaLinux 9

### Recommended Production Requirements (High-Throughput Replays)
- **CPU:** 4+ vCPU cores (x86_64 or aarch64)
- **RAM:** 8–16 GB RAM
- **Disk:** 50+ GB NVMe SSD storage
- **Network:** 1 Gbps port with public static IP and DNS domain configured

---

## Prerequisites

Before starting, ensure the host system has the following installed:

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker Engine and Docker Compose plugin
sudo apt install -y curl git ufw nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify installations
docker --version
docker compose version
nginx -v
```

---

## Step 1: Clone Repository & Directory Structure

Create a dedicated application directory:

```bash
sudo mkdir -p /opt/prism
sudo chown -R $USER:$USER /opt/prism
cd /opt/prism

# Clone repository
git clone https://github.com/DevNiola/Prism.git .
```

---

## Step 2: Environment Variable Configuration

Prism uses environment variables to configure ports, connections, and external service credentials.

### Production Environment File (`.env.production`)

Create `/opt/prism/.env.production`:

```bash
cat << 'EOF' > /opt/prism/.env.production
# ==========================================
# Core Environment
# ==========================================
NODE_ENV=production
HOST=0.0.0.0
PORT=3001

# ==========================================
# Redis Configuration
# ==========================================
REDIS_HOST=prism-redis
REDIS_PORT=6379
REDIS_PASSWORD=YourSuperSecureRedisPasswordHere!123
REDIS_URL=redis://:YourSuperSecureRedisPasswordHere!123@prism-redis:6379

# ==========================================
# AI Explanation Engine (OpenAI / Compatible)
# ==========================================
AI_API_KEY=sk-proj-your-actual-api-key-here
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_MAX_TOKENS_PER_REQUEST=2048
AI_TEMPERATURE=0.2
AI_TIMEOUT_MS=30000

# ==========================================
# Budget & Rate Limits
# ==========================================
AI_HOURLY_TOKEN_LIMIT=100000
AI_DAILY_TOKEN_LIMIT=1000000
AI_MAX_CONCURRENT=5

# ==========================================
# Cache & Deduplication TTLs (Seconds)
# ==========================================
CACHE_DECODE_TTL=86400
CACHE_PROFILE_TTL=3600
DEDUP_WINDOW_MS=10000

# ==========================================
# Web Application Frontend
# ==========================================
NEXT_PUBLIC_API_URL=https://prism.yourdomain.com/api
NEXT_PUBLIC_WS_URL=wss://prism.yourdomain.com/ws
SESSION_SECRET=e7b4c91038290f14a8b7923485c0192384750192837465019283746501928374
EOF
```

### Environment Variables Reference Table

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | string | `production` | Node environment runtime flag (`production` or `development`). |
| `PORT` | number | `3001` | Internal HTTP port Fastify listens on. |
| `HOST` | string | `0.0.0.0` | Host binding interface for containers. |
| `REDIS_URL` | string | `redis://localhost:6379` | Full connection URI including credentials for Redis. |
| `AI_API_KEY` | string | `""` | API key for OpenAI or compatible LLM diagnostic explanations. |
| `AI_API_BASE_URL` | string | `https://api.openai.com/v1` | LLM provider base URL. |
| `AI_MODEL` | string | `gpt-4o-mini` | LLM model identifier for diagnostic reports. |
| `AI_HOURLY_TOKEN_LIMIT` | number | `100000` | Hourly token consumption ceiling before throttling. |
| `AI_DAILY_TOKEN_LIMIT` | number | `1000000` | Daily token ceiling before throttling. |
| `AI_MAX_CONCURRENT` | number | `5` | Maximum simultaneous AI explanation requests. |
| `NEXT_PUBLIC_API_URL` | string | `/api` | Public URL prefix where frontend reaches the backend API. |
| `SESSION_SECRET` | string | `""` | 32+ character random secret used for session signature verification. |

---

## Step 3: Docker Compose Deployment

A production-ready `docker-compose.yml` ensures all services start in order, communicate over an isolated internal network, and persist state.

Create or verify `/opt/prism/docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: prism-redis
    restart: always
    command: >
      redis-server 
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes 
      --maxmemory 1gb 
      --maxmemory-policy volatile-lru
    volumes:
      - redis_data:/data
    networks:
      - prism-internal
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    image: devniola/prism-server:latest
    container_name: prism-server
    restart: always
    env_file:
      - .env.production
    ports:
      - "127.0.0.1:3001:3001"
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - prism-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 15s
      timeout: 5s
      retries: 3

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    image: devniola/prism-web:latest
    container_name: prism-web
    restart: always
    environment:
      - NODE_ENV=production
      - PORT=3000
      - NEXT_PUBLIC_API_URL=/api
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - server
    networks:
      - prism-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/"]
      interval: 20s
      timeout: 5s
      retries: 3

networks:
  prism-internal:
    driver: bridge

volumes:
  redis_data:
    driver: local
```

### Launch Containers
```bash
# Build and start services in the background
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps
```

---

## Step 4: Redis Setup & Hardening

If you prefer using a host-managed or cloud-hosted Redis rather than containerized Redis:

1. **Install Redis natively on Ubuntu:**
   ```bash
   sudo apt install -y redis-server
   ```
2. **Edit configuration (`/etc/redis/redis.conf`):**
   ```conf
   bind 127.0.0.1 ::1
   protected-mode yes
   requirepass YourSuperSecureRedisPasswordHere!123
   appendonly yes
   maxmemory 1gb
   maxmemory-policy volatile-lru
   ```
3. **Restart and enable Redis:**
   ```bash
   sudo systemctl restart redis-server
   sudo systemctl enable redis-server
   ```
4. **Update `REDIS_URL` in `.env.production`:**
   ```bash
   REDIS_URL=redis://:YourSuperSecureRedisPasswordHere!123@127.0.0.1:6379
   ```

---

## Step 5: Reverse Proxy (Nginx) Configuration

Nginx acts as the secure front-door, terminating SSL, proxying API and Web requests, and managing WebSocket persistent connections.

Create `/etc/nginx/sites-available/prism.conf`:

```nginx
# Map connection upgrades for WebSocket support
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream prism_web_upstream {
    server 127.0.0.1:3000;
    keepalive 32;
}

upstream prism_server_upstream {
    server 127.0.0.1:3001;
    keepalive 32;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name prism.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS Server Block
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name prism.yourdomain.com;

    # SSL Certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/prism.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/prism.yourdomain.com/privkey.pem;

    # Modern SSL Protocols & Ciphers
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Request limits
    client_max_body_size 32M;

    # Fastify Server Health Check
    location = /health {
        proxy_pass http://prism_server_upstream/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Fastify Backend API
    location /api/ {
        proxy_pass http://prism_server_upstream/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    # WebSocket Trace Stream Gateway
    location /ws {
        proxy_pass http://prism_server_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Next.js Web Frontend & Static Assets
    location / {
        proxy_pass http://prism_web_upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache Next.js static bundles
    location /_next/static/ {
        proxy_pass http://prism_web_upstream;
        proxy_cache_bypass $http_upgrade;
        expires 365d;
        access_log off;
    }
}
```

Enable site configuration:

```bash
sudo ln -s /etc/nginx/sites-available/prism.conf /etc/nginx/sites-enabled/
sudo nginx -t
```

---

## Step 6: SSL/TLS Setup with Let's Encrypt (Certbot)

Obtain free, automated SSL/TLS certificates using EFF's Certbot:

```bash
# Run Certbot interactive installer
sudo certbot --nginx -d prism.yourdomain.com

# Test automatic renewal
sudo certbot renew --dry-run

# Reload Nginx with new certificate
sudo systemctl reload nginx
```

---

## Step 7: Firewall & Port Hardening (UFW)

Only ports `80` (HTTP), `443` (HTTPS), and `22` (SSH) should be open to the public internet. Redis (`6379`) and application ports (`3000`, `3001`) must remain bound to `127.0.0.1` or the internal Docker network.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
sudo ufw status verbose
```

---

## Step 8: Verification & Health Checks

Verify all services are operating nominally:

```bash
# 1. Verify Docker containers are healthy
docker compose -f docker-compose.prod.yml ps

# 2. Test Backend Health Endpoint directly
curl -i http://127.0.0.1:3001/health
# Expected: HTTP/1.1 200 OK {"status":"ok","version":"0.1.0"}

# 3. Test Frontend HTML generation
curl -i http://127.0.0.1:3000/
# Expected: HTTP/1.1 200 OK

# 4. Test External Domain via HTTPS
curl -i https://prism.yourdomain.com/health
# Expected: HTTP/2 200 OK {"status":"ok","version":"0.1.0"}
```

---

## Maintenance & Operations

### Viewing Logs
```bash
# Follow all container logs
docker compose -f docker-compose.prod.yml logs -f

# Follow Fastify server logs specifically
docker compose -f docker-compose.prod.yml logs -f server
```

### Backing up Redis Data
The Redis data volume is stored at `/var/lib/docker/volumes/prism_redis_data/_data`.
To trigger an instant disk snapshot:
```bash
docker exec -it prism-redis redis-cli -a "$REDIS_PASSWORD" bgsave
```

### Upgrading Prism
```bash
cd /opt/prism
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

---

## Settlement Wallet

All official contributions and deployments are tracked with the settlement wallet:
`0x8366bCe3a2D379Dec7656D7A67015789FaF999f20`
