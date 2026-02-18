#!/bin/bash

# ================================================
# DEPLOYMENT - Node.js + Nginx + SSL
# ================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "════════════════════════════════════════════════════════"
echo "  🚀 WhatsApp API - Deployment"
echo "════════════════════════════════════════════════════════"
echo -e "${NC}"

# Actualizar código
echo -e "\n${YELLOW}📥 Actualizando código...${NC}"
git fetch origin
git reset --hard origin/main
git pull origin main
echo -e "${GREEN}✅ Código actualizado${NC}"

# Verificar .env
if [ ! -f .env ]; then
    echo -e "${RED}❌ Falta archivo .env${NC}"
    echo -e "${BLUE}cp .env.example .env && nano .env${NC}"
    exit 1
fi

source .env

# Instalar dependencias
echo -e "\n${YELLOW}📦 Instalando dependencias...${NC}"
npm install --production
echo -e "${GREEN}✅ Dependencias instaladas${NC}"

# Permisos
echo -e "\n${YELLOW}🔐 Configurando permisos...${NC}"
mkdir -p auth logs
chmod 755 auth
echo -e "${GREEN}✅ Permisos configurados${NC}"

# PM2
echo -e "\n${YELLOW}🔄 Reiniciando aplicación...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi
pm2 delete whatsapp-api 2>/dev/null || true
pm2 start server.js --name whatsapp-api
pm2 save
echo -e "${GREEN}✅ Aplicación reiniciada${NC}"

# Nginx
if [ ! -f /etc/nginx/sites-available/whatsapp-api ]; then
    echo -e "\n${YELLOW}⚙️  Configurando Nginx...${NC}"
    
    if ! command -v nginx &> /dev/null; then
        sudo apt update
        sudo apt install -y nginx
    fi
    
    sudo tee /etc/nginx/sites-available/whatsapp-api > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
    
    sudo ln -sf /etc/nginx/sites-available/whatsapp-api /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    echo -e "${GREEN}✅ Nginx configurado${NC}"
fi

# SSL
if [ ! -d /etc/letsencrypt/live/$DOMAIN ]; then
    echo -e "\n${YELLOW}🔐 Configurando SSL...${NC}"
    
    if ! command -v certbot &> /dev/null; then
        sudo apt install -y certbot python3-certbot-nginx
    fi
    
    sudo certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --no-eff-email --redirect -n
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ SSL configurado${NC}"
    else
        echo -e "${YELLOW}⚠️  SSL pendiente${NC}"
    fi
fi

# Estado
echo -e "\n${YELLOW}📊 Estado:${NC}\n"
pm2 status
pm2 logs whatsapp-api --lines 10 --nostream

# Detectar protocolo
if [ -d /etc/letsencrypt/live/$DOMAIN ]; then
    PROTOCOL="https"
else
    PROTOCOL="http"
fi

echo -e "\n${BLUE}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}📱 Aplicación: ${BLUE}${PROTOCOL}://$DOMAIN${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════${NC}\n"