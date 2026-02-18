#!/bin/bash

# ================================================
# SCRIPT DE ACTUALIZACIÓN RÁPIDA
# Solo actualiza código y reinicia servicios
# ================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔄 Actualización rápida - WhatsApp API${NC}\n"

# Actualizar código
echo -e "${YELLOW}📥 Actualizando código...${NC}"
git fetch origin
git reset --hard origin/main
git pull origin main
echo -e "${GREEN}✅ Código actualizado${NC}\n"

# Reiniciar servicios
echo -e "${YELLOW}🔄 Reiniciando servicios...${NC}"
docker-compose restart
echo -e "${GREEN}✅ Servicios reiniciados${NC}\n"

# Mostrar logs
echo -e "${YELLOW}📊 Últimos logs:${NC}\n"
docker-compose logs --tail=30 app

echo -e "\n${GREEN}✅ Actualización completada${NC}"
echo -e "${BLUE}Ver logs en tiempo real: docker-compose logs -f${NC}\n"
