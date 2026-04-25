FROM node:20-alpine

# Define o diretório principal de trabalho dentro do container
WORKDIR /app

# Copia o package.json e o package-lock.json primeiro (aproveita o cache do Docker)
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install

# Copia o restante dos arquivos da aplicação
COPY . .

# Expõe a porta 3000 (onde o app roda)
EXPOSE 3000

# Comando que será executado quando o container iniciar
CMD ["npm", "start"]
