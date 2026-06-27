import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/database.js";

const router = express.Router();

// --- ENDPOINT DE LOGIN ---
router.post("/login", async (req, res) => {
  console.log("Intento de login con datos:", req.body);
  console.log(req.ip, req.method, req.originalUrl);
  try {
    const { email, password } = req.body;

    // 1. Validar que no envíen datos vacíos
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email y contraseña son obligatorios" });
    }

    // 2. Buscar al usuario en la BD (Nota: Usamos '?' para evitar Inyección SQL)
    const [rows] = await pool.execute(
      "SELECT id, nombre, email, rol, password_hash, activo FROM usuarios WHERE email = ?",
      [email],
    );

    // Si no existe el correo en la BD
    if (rows.length === 0) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    const user = rows[0];

    // 3. Verificar si el usuario está activo (activo = 1)
    if (user.activo === 0) {
      return res.status(403).json({ error: "Esta cuenta ha sido desactivada" });
    }
    const passwordWithKey = password + process.env.PASSWORD_KEY;
    // Comparamos usando la contraseña combinada
    const validPassword = await bcrypt.compare(
      passwordWithKey,
      user.password_hash,
    );
    // 4. Comparar la contraseña enviada con el Hash de la BD

    if (!validPassword) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    // 5. Crear el Payload del Token (solo datos necesarios, NUNCA el password)
    const tokenPayload = {
      id: user.id,
      rol: user.rol,
      nombre: user.nombre,
    };

    // Generar el Access Token (Corto - ej: 15m)
    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    // Generar el Refresh Token (Largo - ej: 30d)
    const refreshSecret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + "_refresh";
    const refreshToken = jwt.sign(tokenPayload, refreshSecret, {
      expiresIn: "30d",
    });

    // 6. Responder a la app de MAUI (Status 200 OK implícito en res.json)
    res.json({
      mensaje: "Login exitoso",
      accessToken,
      refreshToken,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    });
  } catch (error) {
    console.error("Error en el login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});
// --- ENDPOINT DE REGISTRO (POST) ---
router.post("/register", async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    // 1. Validaciones básicas de campos obligatorios
    if (!nombre || !email || !password) {
      return res
        .status(400)
        .json({ error: "Nombre, email y contraseña son obligatorios" });
    }

    // 3. Verificar si el correo ya está registrado
    const [existingUser] = await pool.execute(
      "SELECT id FROM usuarios WHERE email = ?",
      [email],
    );

    if (existingUser.length > 0) {
      return res
        .status(409)
        .json({ error: "El correo electrónico ya está registrado" });
    }

    // 4. APLICAR LA KEY (PEPPER) + BCRYPT
    const passwordWithKey = password + process.env.PASSWORD_KEY;

    const saltRounds = parseInt(process.env.PASSWORD_SALT_ROUNDS);
    const hashedPassword = await bcrypt.hash(passwordWithKey, saltRounds);

    // 5. Insertar el nuevo cliente en la Base de Datos
    // NOTA: activo = 1 por defecto, y fecha_registro = NOW()
    const [result] = await pool.execute(
      `INSERT INTO usuarios (nombre, email,  rol, password_hash, fecha_registro, activo) VALUES (?, ?, ?,?, NOW(), 1)`,
      [nombre, email, "cliente", hashedPassword],
    );
    const usuario = {
      id: result.insertId,
      nombre: nombre,
      email: email,
      rol: "cliente",
    };
    const tokenPayload = {
      id: usuario.id,
      rol: usuario.rol,
      nombre: usuario.nombre,
    };
    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const refreshSecret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + "_refresh";
    const refreshToken = jwt.sign(tokenPayload, refreshSecret, {
      expiresIn: "30d",
    });

    // 6. Responder con éxito
    res.status(201).json({
      mensaje: "Usuario registrado exitosamente",
      accessToken,
      refreshToken,
      usuario,
    });
  } catch (error) {
    console.error("Error en el registro:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor al registrar usuario" });
  }
});
// --- ENDPOINT REFRESH TOKEN ---
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token es requerido" });
  }

  const refreshSecret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + "_refresh";

  jwt.verify(refreshToken, refreshSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Refresh token inválido o expirado" });
    }

    // Generar un nuevo access token
    const tokenPayload = {
      id: user.id,
      rol: user.rol,
      nombre: user.nombre,
    };

    const newAccessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    res.json({
      accessToken: newAccessToken
    });
  });
});

export default router;
