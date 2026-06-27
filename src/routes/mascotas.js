import express from "express";
import {pool} from "../config/database.js";
import {authenticateToken} from "../middleware/auth.js";

const router=express.Router();
router.use(authenticateToken);
// 1. Obtener las mascotas del usuario autenticado
router.get("/mias", async (req, res) => {
  try {
    const idUsuario = req.user.id;

    const [mascotas] = await pool.execute(
      `SELECT id, nombre, fecha_nacimiento as fechaNacimiento, sexo, esterilizado, id_especie as idEspecie, foto_url as fotoUrl 
       FROM mascotas 
       WHERE id_usuario = ?`,
      [idUsuario],
    );

    // MySQL devuelve TINYINT como 0/1; C# espera boolean
    const mascotasFormateadas = mascotas.map(m => ({
      ...m,
      esterilizado: m.esterilizado === 1
    }));

    res.json(mascotasFormateadas);
  } catch (error) {
    console.error("Error al obtener mascotas:", error);
    res.status(500).json({ error: "Error al obtener tus mascotas" });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/mascotas
//  Crea una nueva mascota para el usuario autenticado (cliente)
// ═══════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  try {
    const idUsuario = req.user.id;
    const { nombre, fechaNacimiento, sexo, esterilizado, idEspecie } = req.body;

    if (!nombre || !sexo || !idEspecie) {
      return res.status(400).json({ error: "Nombre, sexo y especie son obligatorios." });
    }

    const [result] = await pool.execute(
      `INSERT INTO mascotas (nombre, fecha_nacimiento, sexo, esterilizado, id_especie, id_usuario) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        fechaNacimiento || null,
        sexo,
        esterilizado ? 1 : 0,
        idEspecie,
        idUsuario
      ]
    );

    res.status(201).json({
      id: result.insertId,
      nombre,
      fechaNacimiento: fechaNacimiento || null,
      sexo,
      esterilizado: esterilizado || false,
      idEspecie
    });
  } catch (error) {
    console.error("Error al crear mascota:", error);
    res.status(500).json({ error: "Error al registrar la mascota" });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/mascotas/cliente/:clienteId
//  Retorna las mascotas de un cliente específico.
//  Solo accesible por veterinarios o administradores.
// ═══════════════════════════════════════════════════════════
router.get("/cliente/:clienteId", async (req, res) => {
  try {
    const rol = req.user.rol;
    if (rol !== "veterinario" && rol !== "administrador") {
      return res.status(403).json({ error: "Acceso denegado: solo veterinarios pueden consultar mascotas de clientes." });
    }

    const clienteId = req.params.clienteId;

    const [mascotas] = await pool.execute(
      `SELECT m.id, m.nombre, DATE_FORMAT(m.fecha_nacimiento, '%Y-%m-%d') as fechaNacimiento, 
              m.sexo, m.esterilizado, m.id_especie as idEspecie, m.foto_url as fotoUrl,
              e.nombre_comun as especieNombre
       FROM mascotas m
       LEFT JOIN especies e ON m.id_especie = e.id
       WHERE m.id_usuario = ?
       ORDER BY m.nombre ASC`,
      [clienteId]
    );

    const mascotasFormateadas = mascotas.map(m => ({
      ...m,
      esterilizado: m.esterilizado === 1
    }));

    res.json(mascotasFormateadas);
  } catch (error) {
    console.error("Error al obtener mascotas del cliente:", error);
    res.status(500).json({ error: "Error al obtener las mascotas del cliente" });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/mascotas/cliente/:clienteId
//  Crea una nueva mascota para un cliente específico.
//  Solo accesible por veterinarios o administradores.
//  Body: { nombre, fechaNacimiento, sexo, esterilizado, idEspecie }
// ═══════════════════════════════════════════════════════════
router.post("/cliente/:clienteId", async (req, res) => {
  try {
    const rol = req.user.rol;
    if (rol !== "veterinario" && rol !== "administrador") {
      return res.status(403).json({ error: "Acceso denegado: solo veterinarios pueden registrar mascotas para clientes." });
    }

    const clienteId = req.params.clienteId;
    const { nombre, fechaNacimiento, sexo, esterilizado, idEspecie } = req.body;

    // Validación básica
    if (!nombre || !sexo || !idEspecie) {
      return res.status(400).json({ error: "Nombre, sexo y especie son obligatorios." });
    }

    // Verificar que el cliente existe
    const [clientes] = await pool.execute(
      `SELECT id FROM usuarios WHERE id = ? AND activo = 1`,
      [clienteId]
    );

    if (clientes.length === 0) {
      return res.status(404).json({ error: "El cliente no existe." });
    }

    const [result] = await pool.execute(
      `INSERT INTO mascotas (nombre, fecha_nacimiento, sexo, esterilizado, id_especie, id_usuario) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nombre,
        fechaNacimiento || null,
        sexo,
        esterilizado ? 1 : 0,
        idEspecie,
        clienteId
      ]
    );

    res.status(201).json({
      id: result.insertId,
      nombre,
      fechaNacimiento: fechaNacimiento || null,
      sexo,
      esterilizado: esterilizado || false,
      idEspecie
    });
  } catch (error) {
    console.error("Error al crear mascota para cliente:", error);
    res.status(500).json({ error: "Error al registrar la mascota" });
  }
});

export default router;  