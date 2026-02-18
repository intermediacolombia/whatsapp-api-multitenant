#!/bin/bash

# ================================================
# SCRIPT DE ROLLBACK
# Vuelve a la versión anterior
# ================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}⚠️  ROLLBACK - Volver a versión anterior${NC}\n"

# Confirmar
read -p "¿Estás seguro de volver a la versión anterior? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operación cancelada"
    exit 1
fi

# Detener servicios
echo -e "${YELLOW}🛑 Deteniendo servicios...${NC}"
docker-compose down

# Volver al commit anterior
echo -e "${YELLOW}⏮️  Volviendo a commit anterior...${NC}"
git reset --hard HEAD~1

# Reiniciar
echo -e "${YELLOW}🚀 Iniciando servicios...${NC}"
docker-compose up -d --build

sleep 5

# Verificar
echo -e "\n${YELLOW}📊 Estado de servicios:${NC}\n"
docker-compose ps

echo -e "\n${GREEN}✅ Rollback completado${NC}"
echo -e "${YELLOW}Versión actual:${NC}"
git log --oneline -1
