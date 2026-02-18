# 🚀 WhatsApp API Multi-Tenant - Deployment Guide

Guía completa para desplegar la API de WhatsApp en producción con Docker, Nginx y SSL.

---

## 📋 Requisitos Previos

### En tu servidor Linux:
- ✅ Docker instalado
- ✅ Docker Compose instalado
- ✅ Dominio apuntando al servidor (DNS configurado)
- ✅ Puertos 80 y 443 abiertos en firewall
- ✅ MySQL remoto accesible

### En tu MySQL remoto:
- ✅ Base de datos creada
- ✅ Usuario con permisos
- ✅ Script SQL ejecutado (`database-schema.sql`)
- ✅ Firewall permitiendo conexiones desde tu servidor

---

## 🔧 Instalación de Docker (Ubuntu/Debian)

```bash
# Actualizar paquetes
sudo apt update

# Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Agregar usuario al grupo docker
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verificar instalación
docker --version
docker-compose --version

# Cerrar sesión y volver a entrar para aplicar cambios de grupo
```

---

## 📦 Preparar Archivos del Proyecto

### 1. Subir archivos al servidor

```bash
# Opción A: Clonar desde Git
git clone tu-repositorio.git
cd tu-repositorio

# Opción B: Subir via SCP/SFTP
scp -r /ruta/local/* usuario@servidor:/home/usuario/whatsapp-api/
```

### 2. Estructura de archivos necesarios

```
whatsapp-api/
├── server.js                    # Servidor principal
├── whatsapp.js                  # Clase WhatsApp
├── package.json                 # Dependencias
├── Dockerfile                   # Imagen Docker
├── docker-compose.yml           # Orquestación
├── .env.example                 # Template de configuración
├── deploy.sh                    # Script de deployment
├── .dockerignore               # Archivos a ignorar
├── database-schema.sql         # Schema de BD (ejecutar en MySQL remoto)
├── public/
│   ├── login.html
│   ├── panel.html
│   ├── admin-login.html
│   └── admin-panel.html
└── nginx/
    ├── nginx.conf
    └── conf.d/
        └── whatsapp.conf.template
```

---

## ⚙️ Configuración

### 1. Configurar variables de entorno

```bash
# Copiar template
cp .env.example .env

# Editar con tus valores
nano .env
```

**Contenido del .env:**
```bash
# MySQL REMOTO
DB_HOST=tu-mysql.tudominio.com      # Tu servidor MySQL
DB_PORT=3306
DB_USER=whatsapp_user
DB_PASSWORD=tu_password_seguro
DB_NAME=whatsapp_api_multitenant

# Dominio y SSL
DOMAIN=api.tudominio.com            # Tu dominio/subdominio
EMAIL=tu-email@tudominio.com        # Email para Let's Encrypt

# Node.js
NODE_ENV=production
PORT=3000
```

### 2. Verificar MySQL remoto

```bash
# Probar conexión a MySQL desde el servidor
mysql -h tu-mysql.tudominio.com -u whatsapp_user -p

# Una vez conectado, verificar la base de datos
SHOW DATABASES;
USE whatsapp_api_multitenant;
SHOW TABLES;

# Salir
exit;
```

### 3. Configurar DNS

Asegúrate que tu dominio apunta al servidor:

```bash
# Verificar DNS
nslookup api.tudominio.com

# o
dig api.tudominio.com
```

Debe mostrar la IP de tu servidor.

---

## 🚀 Deployment

### Opción A: Usando el script automático (Recomendado)

```bash
# Dar permisos de ejecución
chmod +x deploy.sh

# Ejecutar deployment
./deploy.sh
```

El script hará:
1. ✅ Verificar requisitos
2. ✅ Crear directorios
3. ✅ Generar configuración de Nginx
4. ✅ Obtener certificado SSL
5. ✅ Construir imágenes Docker
6. ✅ Iniciar servicios

### Opción B: Deployment manual

```bash
# 1. Crear directorios
mkdir -p auth logs nginx/conf.d certbot/conf certbot/www

# 2. Generar configuración de Nginx
source .env
envsubst '${DOMAIN}' < nginx/conf.d/whatsapp.conf.template > nginx/conf.d/whatsapp.conf

# 3. Construir imágenes
docker-compose build

# 4. Obtener certificado SSL (primera vez)
docker-compose up -d nginx
docker-compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN

# 5. Iniciar todos los servicios
docker-compose up -d
```

---

## 🔍 Verificación

### Verificar que los servicios están corriendo

```bash
# Ver estado de contenedores
docker-compose ps

# Deberías ver:
# whatsapp_app     Up
# whatsapp_nginx   Up
# whatsapp_certbot Up
```

### Ver logs

```bash
# Todos los servicios
docker-compose logs -f

# Solo app
docker-compose logs -f app

# Solo nginx
docker-compose logs -f nginx

# Últimas 100 líneas
docker-compose logs --tail=100
```

### Probar la API

```bash
# Verificar que responde
curl https://api.tudominio.com

# Debería devolver el HTML del login
```

---

## 🔐 Accesos

### Login de Clientes
```
URL: https://api.tudominio.com/
Email: admin@activgym.com
Password: activgym123
```

### Login de Admin
```
URL: https://api.tudominio.com/admin-login.html
Usuario: admin
Password: admin123
```

⚠️ **IMPORTANTE:** Cambia las contraseñas por defecto en la base de datos.

---

## 🛠️ Comandos Útiles

### Gestión de contenedores

```bash
# Iniciar servicios
docker-compose up -d

# Detener servicios
docker-compose down

# Reiniciar servicios
docker-compose restart

# Reiniciar solo la app
docker-compose restart app

# Ver logs en tiempo real
docker-compose logs -f app

# Ejecutar comando en el contenedor
docker-compose exec app sh

# Ver uso de recursos
docker stats
```

### Actualizar la aplicación

```bash
# 1. Subir nuevos archivos al servidor

# 2. Rebuild y reiniciar
docker-compose build app
docker-compose up -d app

# O todo junto
docker-compose up -d --build
```

### Renovar certificado SSL manualmente

```bash
docker-compose run --rm certbot renew
docker-compose restart nginx
```

### Limpiar todo (CUIDADO)

```bash
# Detener y eliminar contenedores
docker-compose down

# Eliminar volúmenes (elimina auth y logs)
docker-compose down -v

# Eliminar imágenes
docker-compose down --rmi all
```

---

## 🔧 Troubleshooting

### Error: "Cannot connect to MySQL"

```bash
# Verificar variables de entorno
docker-compose exec app env | grep DB_

# Probar conexión desde el contenedor
docker-compose exec app sh
wget -qO- telnet://$DB_HOST:$DB_PORT
```

**Soluciones:**
- Verificar que MySQL remoto permite conexiones desde la IP del servidor
- Verificar firewall de MySQL
- Verificar credenciales en .env

### Error: "Permission denied" en auth/

```bash
# Dar permisos a la carpeta auth
sudo chown -R 1001:1001 auth/
sudo chmod -R 755 auth/
```

### Error SSL: "Certificate not found"

```bash
# Verificar que el certificado existe
ls -la certbot/conf/live/$DOMAIN/

# Si no existe, obtenerlo
docker-compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    -d $DOMAIN
```

### Nginx no inicia

```bash
# Ver logs de Nginx
docker-compose logs nginx

# Verificar sintaxis de configuración
docker-compose exec nginx nginx -t

# Si hay error de sintaxis, corregir nginx/conf.d/whatsapp.conf
```

### WhatsApp no se conecta (QR no aparece)

```bash
# Ver logs de la app
docker-compose logs -f app

# Reiniciar app
docker-compose restart app

# Limpiar sesiones antiguas
rm -rf auth/*
docker-compose restart app
```

---

## 📊 Monitoreo

### Ver uso de recursos

```bash
# CPU, RAM, Network de cada contenedor
docker stats

# Espacio en disco
df -h

# Logs ocupando espacio
du -sh /var/lib/docker/
```

### Configurar alertas (Opcional)

```bash
# Instalar monitoreo con Prometheus + Grafana
# O servicios cloud como DataDog, New Relic
```

---

## 🔒 Seguridad

### Cambiar contraseñas por defecto

```sql
-- Conectar a MySQL
mysql -h tu-mysql.com -u whatsapp_user -p

USE whatsapp_api_multitenant;

-- Cambiar password del cliente
-- Generar hash: node -e "console.log(require('bcrypt').hashSync('nueva_password', 10))"
UPDATE clients SET password = '$2b$10$HASH_AQUI' WHERE client_id = 'activgym';

-- Cambiar password del admin
UPDATE admin_users SET password = '$2b$10$HASH_AQUI' WHERE username = 'admin';
```

### Configurar firewall

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Verificar
sudo ufw status
```

### Backups

```bash
# Backup de sesiones de WhatsApp
tar -czf auth-backup-$(date +%Y%m%d).tar.gz auth/

# Backup de MySQL (desde tu servidor MySQL)
mysqldump -h localhost -u root -p whatsapp_api_multitenant > backup-$(date +%Y%m%d).sql
```

---

## 📞 Soporte

Para problemas o preguntas:
1. Revisa los logs: `docker-compose logs -f`
2. Verifica la sección de Troubleshooting
3. Contacta al equipo de desarrollo

---

## ✅ Checklist de Deployment

- [ ] Docker y Docker Compose instalados
- [ ] DNS configurado (dominio apunta al servidor)
- [ ] Puertos 80 y 443 abiertos
- [ ] MySQL remoto accesible
- [ ] Base de datos creada y script SQL ejecutado
- [ ] Archivo .env configurado
- [ ] Certificado SSL obtenido
- [ ] Servicios iniciados con `docker-compose up -d`
- [ ] Login funcionando en https://tudominio.com
- [ ] WhatsApp QR code visible
- [ ] Contraseñas por defecto cambiadas
- [ ] Backups configurados

---

¡Deployment completado! 🎉
