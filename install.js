const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('🚀 Iniciando instalação manual das dependências...\n');

const dependencies = {
  "express": "4.18.2",
  "whatsapp-web.js": "1.23.0",
  "qrcode": "1.5.3",
  "cors": "2.8.5",
  "body-parser": "1.20.2",
  "dotenv": "16.3.1",
  "fs-extra": "11.1.1",
  "mysql2": "3.6.5"
};

let installed = 0;
const total = Object.keys(dependencies).length;

function installPackage(name, version) {
  return new Promise((resolve, reject) => {
    console.log(`📦 Instalando ${name}@${version}...`);
    
    exec(`npm install ${name}@${version} --no-save`, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Erro ao instalar ${name}:`, error.message);
        reject(error);
      } else {
        installed++;
        console.log(`✅ ${name} instalado (${installed}/${total})\n`);
        resolve();
      }
    });
  });
}

async function installAll() {
  console.log(`Total de pacotes: ${total}\n`);
  
  for (const [name, version] of Object.entries(dependencies)) {
    try {
      await installPackage(name, version);
    } catch (error) {
      console.error(`Falha em ${name}, continuando...`);
    }
  }
  
  console.log('\n🎉 Instalação concluída!');
  console.log(`✅ Pacotes instalados: ${installed}/${total}`);
}

installAll();
