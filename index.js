import express from "express";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuración del Pool de conexiones a la base de datos
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'local',
  dateStrings: true
});

// Middleware para proteger rutas con JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res
      .status(401)
      .json({ error: "Acceso denegado, token no proporcionado" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err)
      return res.status(403).json({ error: "Token inválido o expirado" });
    req.user = user;
    next();
  });
};

async function startServer() {
  try {
    const connection = await pool.getConnection();
    console.log(`Conexión exitosa a la base de datos: ${process.env.DB_NAME}`);
    connection.release();

    app.listen(PORT, () => {
      console.log(`Servidor API REST corriendo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error(
      "Error crítico al iniciar el servidor o conectar a la BD:",
      error.message,
    );
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.json({ mensaje: "Bienvenido a la API de Veterinaria Antioquia" });
});

// --- ENDPOINT DE LOGIN ---
app.post("/api/auth/login", async (req, res) => {
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

    // Generar el Token
    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    // 6. Responder a la app de MAUI (Status 200 OK implícito en res.json)
    res.json({
      mensaje: "Login exitoso",
      token: accessToken,
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
app.post("/api/auth/register", async (req, res) => {
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
      expiresIn: "30d",
    });

    // 6. Responder con éxito
    res.status(201).json({
      mensaje: "Usuario registrado exitosamente",
      token: accessToken,
      usuario,
    });
  } catch (error) {
    console.error("Error en el registro:", error);
    res
      .status(500)
      .json({ error: "Error interno del servidor al registrar usuario" });
  }
});
// ==========================================
// ENDPOINTS DEL MÓDULO DE CITAS
// ==========================================

// 1. Obtener las mascotas del usuario autenticado
app.get("/api/mascotas/mias", authenticateToken, async (req, res) => {
  try {
    const idUsuario = req.user.id;

    const [mascotas] = await pool.execute(
      `SELECT id, nombre, fecha_nacimiento as fechaNacimiento, sexo, esterilizado, id_especie as idEspecie, foto_url as fotoUrl 
       FROM mascotas 
       WHERE id_usuario = ?`,
      [idUsuario],
    );

    res.json(mascotas);
  } catch (error) {
    console.error("Error al obtener mascotas:", error);
    res.status(500).json({ error: "Error al obtener tus mascotas" });
  }
});

// 2. Obtener la lista de servicios activos
app.get("/api/servicios", authenticateToken, async (req, res) => {
  try {
    const [servicios] = await pool.execute(
      `SELECT id, nombre, descripcion, categoria, precio_base as precioBase, duracion_estimada_min as duracionEstimadaMin, activo 
       FROM servicios 
       WHERE activo = 1`,
    );

    res.json(servicios);
  } catch (error) {
    console.error("Error al obtener servicios:", error);
    res.status(500).json({ error: "Error al obtener los servicios" });
  }
});

// 3. Obtener la lista de veterinarios activos
app.get("/api/usuarios/veterinarios", authenticateToken, async (req, res) => {
  try {
    const [veterinarios] = await pool.execute(
      `SELECT v.id_usuario as id, u.nombre, u.email, u.telefono 
      FROM usuarios u
       INNER JOIN veterinarios v ON u.id = v.id_usuario
       WHERE u.activo = 1`,
    );

    res.json(veterinarios);
  } catch (error) {
    console.error("Error al obtener veterinarios:", error);
    res.status(500).json({ error: "Error al obtener los profesionales" });
  }
});

// 4. Obtener la disponibilidad (citas ya ocupadas) de un veterinario en una fecha
app.get("/api/citas/disponibilidad", authenticateToken, async (req, res) => {
  try {
    const { veterinarioId, fecha } = req.query;

    if (!veterinarioId || !fecha) {
      return res
        .status(400)
        .json({
          error: "Faltan parámetros: veterinarioId y fecha son obligatorios",
        });
    }

    // Buscamos las citas programadas o confirmadas de ese veterinario en esa fecha específica
    const [citasOcupadas] = await pool.execute(
      `SELECT fecha as inicio, duracion_minutos 
       FROM citas 
       WHERE id_veterinario = ? 
       AND DATE(fecha) = ? 
       AND estado IN ('programada', 'confirmada')`,
      [veterinarioId, fecha],
    );

    // Mapeamos para calcular el fin de cada cita sumando los minutos a la fecha de inicio
    const disponibilidad = citasOcupadas.map((cita) => {
      const fechaInicio = new Date(cita.inicio);
      const fechaFin = new Date(
        fechaInicio.getTime() + cita.duracion_minutos * 60000,
      ); // 60000 ms = 1 min

      return {
        inicio: fechaInicio.toISOString(),
        fin: fechaFin.toISOString(),
      };
    });

    res.json(disponibilidad);
  } catch (error) {
    console.error("Error al consultar disponibilidad:", error);
    res
      .status(500)
      .json({ error: "Error al consultar la agenda del veterinario" });
  }
});

// 5. Crear una nueva cita
app.post("/api/citas", authenticateToken, async (req, res) => {
  try {
    var {idMascota} = req.body;
    const {
      idVeterinario,
      idServicio,
      fecha,
      motivo,
      duracionMinutos,
    } = req.body;
    console.log(fecha)
    const idUsuario = req.user.id;
    console.log(req.body)
    // Validación básica
    if (!idVeterinario || !idServicio || !fecha || !duracionMinutos) {
      console.log(idVeterinario,idServicio,fecha,duracionMinutos)
      console.log("ENTRA 1")
      return res
        .status(400)
        .json({ error: "Faltan datos obligatorios para agendar la cita" });
    }
    
    if (idMascota != null) {
      // Seguridad: Verificar que la mascota pertenece al usuario logueado
      const [mascotas] = await pool.execute(
        `SELECT id FROM mascotas WHERE id = ? AND id_usuario = ?`,
        [idMascota, idUsuario],
      );

      if (mascotas.length === 0) {
        console.log("ENTRA 2")
        return res
          .status(403)
          .json({
            error: "No tienes permiso para agendar citas para esta mascota",
          });
      }
      
    }

    // Insertar la cita asignando el estado 'programada' por defecto
    const [result] = await pool.execute(
      `INSERT INTO citas (id_mascota,id_usuario, id_veterinario, id_servicio, fecha, estado, motivo, duracion_minutos) 
       VALUES (?, ?,?, ?, ?, 'programada', ?, ?)`,
      [
        idMascota||null,
        idUsuario,
        idVeterinario,
        idServicio,
        fecha,
        motivo || null,
        duracionMinutos,
      ],
    );
console.log("ENTRA 3")
    res.status(201).json({
      id: result.insertId,
      fecha: fecha,
      estado: "programada",
    });
  } catch (error) {
    console.log("ENTRA 4")
    console.error("Error al crear cita:", error);
    res.status(500).json({ error: "Error al agendar la cita" });
  }
});
// ═══════════════════════════════════════════════════════════
//  GET /api/citas/mias
// ═══════════════════════════════════════════════════════════
app.get("/api/citas/mias", authenticateToken, async (req, res) => {
  try {
    const idUsuario = req.user.id;

    const sqlQuery = `
      SELECT 
        c.id, 
        DATE_FORMAT(c.fecha, '%Y-%m-%dT%H:%i:%s') AS fecha, 
        c.estado, 
        c.motivo, 
        c.duracion_minutos AS duracionMinutos,
        s.nombre AS servicioNombre, 
        s.categoria AS servicioCategoria, 
        s.precio_base AS servicioPrecioBase,
        u_vet.nombre AS veterinarioNombre,
        m.nombre AS mascotaNombre, 
        m.foto_url AS mascotaFotoUrl
      FROM citas c
      INNER JOIN servicios s ON c.id_servicio = s.id
      INNER JOIN usuarios u_vet ON c.id_veterinario = u_vet.id 
      LEFT JOIN mascotas m ON c.id_mascota = m.id
      -- Filtramos directamente por el dueño de la cita
      WHERE c.id_usuario = ?
      ORDER BY c.fecha DESC
    `;

    const [citas] = await pool.execute(sqlQuery, [idUsuario]);

    const citasFormateadas = citas.map(cita => ({
      ...cita,
      servicioPrecioBase: parseFloat(cita.servicioPrecioBase)
    }));

    res.json(citasFormateadas);

  } catch (error) {
    console.error("Error al obtener las citas del usuario:", error);
    res.status(500).json({ error: "Error interno del servidor al obtener las citas" });
  }
});
// ═══════════════════════════════════════════════════════════
//  PATCH /api/citas/:id/cancelar
// ═══════════════════════════════════════════════════════════
app.patch("/api/citas/:id/cancelar", authenticateToken, async (req, res) => {
  try {
    const citaId = req.params.id;
    const idUsuario = req.user.id;
    const { motivo } = req.body; // El nuevo motivo (opcional)
    console.log(citaId, motivo)

    // 1. Buscar la cita y obtener el dueño de la mascota asociada
    const buscarQuery = `
      SELECT id,id_usuario,estado 
      FROM citas
      WHERE id = ?
    `;
    const [citas] = await pool.execute(buscarQuery, [citaId]);
    console.log(citas)
    // Validación 404: La cita no existe
    if (citas.length === 0) {
      return res.status(404).json({ error: "La cita solicitada no existe." });
    }

    const cita = citas[0];

    // Validación 403: La cita existe, pero no es de este usuario
    if (cita.id_usuario !== idUsuario) {
      return res.status(403).json({ error: "Acceso denegado: Esta cita pertenece a otro usuario." });
    }

    // Validación 400: El estado no permite cancelación
    if (cita.estado !== 'programada' && cita.estado !== 'confirmada') {
      return res.status(400).json({ 
        error: `No se puede cancelar la cita porque su estado actual es '${cita.estado}'.` 
      });
    }

    // 2. Si pasó todas las validaciones, procedemos a actualizar
    if (motivo) {
      // Si el cliente envió un motivo, lo sobreescribimos/guardamos
      await pool.execute(
        `UPDATE citas SET estado = 'cancelada', motivo = ? WHERE id = ?`,
        [motivo, citaId]
      );
    } else {
      // Si el motivo viene null o indefinido, solo cambiamos el estado
      await pool.execute(
        `UPDATE citas SET estado = 'cancelada' WHERE id = ?`,
        [citaId]
      );
    }

    // 3. Respuesta de éxito (200 OK)
    res.json({ 
      mensaje: "Cita cancelada correctamente.",
      estado: "cancelada"
    });

  } catch (error) {
    console.error("Error al cancelar la cita:", error);
    res.status(500).json({ error: "Error interno del servidor al procesar la cancelación." });
  }
});

startServer();
