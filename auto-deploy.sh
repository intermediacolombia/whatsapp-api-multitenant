#!/bin/bash

# ================================================
# SCRIPT DE DEPLOYMENT AUTOMÁTICO
# WhatsApp API Multi-Tenant
# ================================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "════════════════════════════════════════════════════════"
echo "  🚀 WhatsApp API - Deployment Automático"
echo "════════════════════════════════════════════════════════"
echo -e "${NC}"

# ================================================
# 1. ACTUALIZAR CÓDIGO DESDE GIT
# ================================================

echo -e "\n${YELLOW}📥 Actualizando código desde GitHub...${NC}"

# Guardar cambios locales si existen
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠️  Hay cambios locales, guardándolos...${NC}"
    git stash
fi

# Actualizar desde GitHub
git fetch origin
git reset --hard origin/main
git pull origin main

echo -e "${GREEN}✅ Código actualizado${NC}"

# ================================================
# 2. VERIFICAR ARCHIVO .env
# ================================================

echo -e "\n${YELLOW}📋 Verificando configuración...${NC}"

if [ ! -f .env ]; then
    echo -e "${RED}❌ Archivo .env no encontrado${NC}"
    echo -e "${YELLOW}Creando desde .env.example...${NC}"
    cp .env.example .env
    echo -e "${RED}⚠️  IMPORTANTE: Edita el archivo .env con tus valores reales${NC}"
    echo -e "${RED}   Ejecuta: nano .env${NC}"
    exit 1
fi

# Cargar variables
source .env

if [ -z "$DB_HOST" ] || [ -z "$DOMAIN" ]; then
    echo -e "${RED}❌ Variables de entorno incompletas en .env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuración verificada${NC}"

# ================================================
# 3. CREAR DIRECTORIOS Y PERMISOS
# ================================================

echo -e "\n${YELLOW}📁 Configurando directorios...${NC}"

# Crear directorios necesarios
mkdir -p auth
mkdir -p logs
mkdir -p nginx/conf.d
mkdir -p certbot/conf
mkdir -p certbot/www

# Dar permisos correctos
echo -e "${YELLOW}🔐 Configurando permisos...${NC}"
sudo chown -R 1001:1001 auth/
sudo chmod -R 755 auth/
sudo chown -R $(whoami):$(whoami) logs/

echo -e "${GREEN}✅ Directorios configurados${NC}"

# ================================================
# 4. LIMPIAR CONTENEDORES ANTIGUOS
# ================================================

echo -e "\n${YELLOW}🧹 Limpiando contenedores antiguos...${NC}"

if docker-compose ps -q 2>/dev/null | grep -q .; then
    docker-compose down
fi

# Limpiar volúmenes huérfanos
docker volume prune -f 2>/dev/null || true

echo -e "${GREEN}✅ Contenedores limpiados${NC}"

# ================================================
# 5. CONSTRUIR E INICIAR SERVICIOS
# ================================================

echo -e "\n${YELLOW}🐳 Construyendo imágenes Docker...${NC}"

docker-compose build --no-cache

echo -e "${GREEN}✅ Imágenes construidas${NC}"

echo -e "\n${YELLOW}🚀 Iniciando servicios...${NC}"

docker-compose up -d

echo -e "${GREEN}✅ Servicios iniciados${NC}"

# ================================================
# 6. ESPERAR A QUE INICIEN LOS SERVICIOS
# ================================================

echo -e "\n${YELLOW}⏳ Esperando a que los servicios inicien...${NC}"

sleep 10

# ================================================
# 7. VERIFICAR ESTADO
# ================================================

echo -e "\n${YELLOW}📊 Verificando estado de los servicios...${NC}\n"

docker-compose ps

# Verificar logs de errores
echo -e "\n${YELLOW}🔍 Verificando logs recientes...${NC}\n"

# Ver últimas 20 líneas de cada servicio
echo -e "${BLUE}═══ App Logs ═══${NC}"
docker-compose logs --tail=20 app | grep -E "(Error|error|✅|❌|🚀)" || echo "Sin errores evidentes"

echo -e "\n${BLUE}═══ Nginx Logs ═══${NC}"
docker-compose logs --tail=20 nginx | grep -E "(error|emerg)" || echo "Sin errores evidentes"

# ================================================
# 8. VERIFICAR CONECTIVIDAD
# ================================================

echo -e "\n${YELLOW}🌐 Verificando conectividad...${NC}"

# Probar endpoint local
if curl -s http://localhost > /dev/null; then
    echo -e "${GREEN}✅ Servidor respondiendo localmente${NC}"
else
    echo -e "${RED}❌ Servidor no responde localmente${NC}"
fi

# ================================================
# 9. RESUMEN FINAL
# ================================================

echo -e "\n${BLUE}"
echo "════════════════════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETADO"
echo "════════════════════════════════════════════════════════"
echo -e "${NC}"

echo -e "${GREEN}📱 Tu aplicación está disponible en:${NC}"
echo -e "   ${BLUE}http://$DOMAIN${NC}"
echo ""
echo -e "${YELLOW}📊 Comandos útiles:${NC}"
echo -e "   Ver logs:        ${BLUE}docker-compose logs -f${NC}"
echo -e "   Ver estado:      ${BLUE}docker-compose ps${NC}"
echo -e "   Reiniciar:       ${BLUE}docker-compose restart${NC}"
echo -e "   Detener:         ${BLUE}docker-compose down${NC}"
echo ""
echo -e "${YELLOW}🔧 Siguientes pasos:${NC}"
echo -e "   1. Abre ${BLUE}http://$DOMAIN${NC} en tu navegador"
echo -e "   2. Inicia sesión con tus credenciales"
echo -e "   3. Escanea el código QR de WhatsApp"
echo ""
echo -e "${GREEN}¡Listo! 🎉${NC}\n"
