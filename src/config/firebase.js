// ═══════════════════════════════════════════════════════════════
//  firebase.js — Configuración de Firebase Admin SDK
// ═══════════════════════════════════════════════════════════════

// 1. Usar importaciones modulares específicas de Firebase
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, "serviceAccountKey.json");

let serviceAccount;

if (process.env.FIREBASE_SA) {
  // Clave embebida en variable de entorno (producción)
  serviceAccount = JSON.parse(process.env.FIREBASE_SA);
} else if (fs.existsSync(keyPath)) {
  // Clave en archivo local (desarrollo)
  const require = createRequire(import.meta.url);
  serviceAccount = require("./serviceAccountKey.json");
} else {
  console.warn(
    "[Firebase]  No se encontró serviceAccountKey.json ni FIREBASE_SA.\n" +
    "  Las notificaciones usarán la tabla SQL como fallback.\n" +
    "  Para habilitar Firestore, sigue las instrucciones en src/config/firebase.js"
  );
}

let db = null;

// 2. Solo inicializamos si realmente obtuvimos el serviceAccount
if (serviceAccount) {
  try {
    initializeApp({
      credential: cert(serviceAccount) // Usamos cert() directamente
    });
    
    db = getFirestore(); // Inicializamos Firestore de forma modular
    console.log("[Firebase] Firestore conectado.");
  } catch (error) {
    console.error("[Firebase] Error inicializando Firebase:", error.message);
  }
}

export { db };