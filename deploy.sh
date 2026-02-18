#!/bin/bash

# ================================================
# SCRIPT DE DEPLOYMENT - WhatsApp API
# ================================================

set -e

echo "🚀 WhatsApp API Multi-Tenant - Deployment Script"
echo "================================================"
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ================================================
# 1. VERIFICAR REQUISITOS
# ================================================

echo "📋 Verificando requisitos..."

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker no está instalado${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose no está instalado${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker y Docker Compose instalados${NC}"

# ================================================
# 2. VERIFICAR ARCHIVO .env
# ================================================

echo ""
echo "📋 Verificando configuración..."

if [ ! -f .env ]; then
    echo -e "${RED}❌ Archivo .env no encontrado${NC}"
    echo ""
    echo "Creando .env desde .env.example..."
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Edita el archivo .env con tus valores reales antes de continuar${NC}"
    echo ""
    echo "Configuración requerida:"
    echo "  - DB_HOST: Tu servidor MySQL remoto"
    echo "  - DB_USER: Usuario de MySQL"
    echo "  - DB_PASSWORD: Contraseña de MySQL"
    echo "  - DOMAIN: Tu dominio (ej: api.tudominio.com)"
    echo "  - EMAIL: Tu email para Let's Encrypt"
    echo ""
    exit 1
fi

# Cargar variables de entorno
source .env

# Verificar variables críticas
if [ -z "$DB_HOST" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DOMAIN" ]; then
    echo -e "${RED}❌ Variables de entorno faltantes en .env${NC}"
    echo ""
    echo "Asegúrate de configurar:"
    echo "  - DB_HOST"
    echo "  - DB_PASSWORD"
    echo "  - DOMAIN"
    echo "  - EMAIL"
    exit 1
fi

echo -e "${GREEN}✅ Archivo .env configurado${NC}"

# ================================================
# 3. CREAR DIRECTORIOS NECESARIOS
# ================================================

echo ""
echo "📁 Creando directorios necesarios..."

mkdir -p auth
mkdir -p logs
mkdir -p nginx/conf.d
mkdir -p certbot/conf
mkdir -p certbot/www

echo -e "${GREEN}✅ Directorios creados${NC}"

# ================================================
# 4. GENERAR CONFIGURACIÓN DE NGINX
# ================================================

echo ""
echo "⚙️  Generando configuración de Nginx..."

# Reemplazar ${DOMAIN} en el template
envsubst '${DOMAIN}' < nginx/conf.d/whatsapp.conf.template > nginx/conf.d/whatsapp.conf

echo -e "${GREEN}✅ Configuración de Nginx generada${NC}"

# ================================================
# 5. OBTENER CERTIFICADO SSL (Primera vez)
# ================================================

echo ""
echo "🔐 Configurando SSL..."

if [ ! -d "certbot/conf/live/$DOMAIN" ]; then
    echo "Obteniendo certificado SSL para $DOMAIN..."
    echo ""
    echo -e "${YELLOW}Nota: Asegúrate que el dominio $DOMAIN apunta a este servidor${NC}"
    echo ""
    read -p "¿Continuar con la obtención del certificado SSL? (y/n) " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Iniciar Nginx temporal para ACME challenge
        docker-compose up -d nginx
        
        # Obtener certificado
        docker-compose run --rm certbot certonly \
            --webroot \
            --webroot-path=/var/www/certbot \
            --email $EMAIL \
            --agree-tos \
            --no-eff-email \
            -d $DOMAIN
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Certificado SSL obtenido${NC}"
        else
            echo -e "${RED}❌ Error obteniendo certificado SSL${NC}"
            exit 1
        fi
        
        # Detener Nginx temporal
        docker-compose down
    else
        echo -e "${YELLOW}⚠️  Certificado SSL no obtenido. Edita nginx/conf.d/whatsapp.conf para usar HTTP${NC}"
    fi
else
    echo -e "${GREEN}✅ Certificado SSL ya existe${NC}"
fi

# ================================================
# 6. CONSTRUIR IMÁGENES
# ================================================

echo ""
echo "🐳 Construyendo imágenes Docker..."

docker-compose build --no-cache

echo -e "${GREEN}✅ Imágenes construidas${NC}"

# ================================================
# 7. INICIAR SERVICIOS
# ================================================

echo ""
echo "🚀 Iniciando servicios..."

docker-compose up -d

echo -e "${GREEN}✅ Servicios iniciados${NC}"

# ================================================
# 8. VERIFICAR ESTADO
# ================================================

echo ""
echo "📊 Verificando estado de los servicios..."
echo ""

docker-compose ps

echo ""
echo "================================================"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETADO${NC}"
echo "================================================"
echo ""
echo "📱 Tu API está disponible en:"
echo "   https://$DOMAIN"
echo ""
echo "🔍 Para ver los logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 Para detener:"
echo "   docker-compose down"
echo ""
echo "🔄 Para reiniciar:"
echo "   docker-compose restart"
echo ""
