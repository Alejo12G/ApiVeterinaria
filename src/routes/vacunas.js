import express from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateToken);

function soloStaff(req, res, next) {
  const rol = req.user?.rol;
  if (rol !== "veterinario" && rol !== "administrador")
    return res.status(403).json({ error: "Acceso denegado." });
  next();
}

// ═══════════════════════════════════════════════════════════════
//  GET /api/vacunas
//  Lista el catálogo de vacunas disponibles.
// ═══════════════════════════════════════════════════════════════
router.get("/", soloStaff, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, nombre, descripcion, duracion_proteccion_meses AS diasInmunidad 
       FROM vacunas ORDER BY nombre`
    );
    res.json(rows);
  } catch (error) {
    console.error("[vacunas.GET] Error:", error);
    res.status(500).json({ error: "Error al obtener catálogo de vacunas." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/vacunas/aplicar
//  Registra la aplicación de una vacuna a una mascota.
//  Body: { idMascota, idVacuna, fechaAplicacion, lote }
// ═══════════════════════════════════════════════════════════════
router.post("/aplicar", soloStaff, async (req, res) => {
  try {
    const idVeterinario = req.user.id;
    const { idMascota, idVacuna, fechaAplicacion, lote } = req.body;

    if (!idMascota || !idVacuna || !fechaAplicacion) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // Obtener días de inmunidad para calcular próxima dosis
    const [vacunas] = await pool.execute(
      `SELECT duracion_proteccion_meses FROM vacunas WHERE id = ?`,
      [idVacuna]
    );

    if (vacunas.length === 0) {
      return res.status(404).json({ error: "Vacuna no encontrada." });
    }

    const mesesInmunidad = vacunas[0].duracion_proteccion_meses;
    let fechaProximaStr = null;

    if (mesesInmunidad > 0) {
      const fechaApp = new Date(fechaAplicacion);
      fechaApp.setMonth(fechaApp.getMonth() + mesesInmunidad);
      fechaProximaStr = fechaApp.toISOString().split("T")[0];
    }

    const [result] = await pool.execute(
      `INSERT INTO vacunaciones 
       (id_mascota, id_vacuna, id_veterinario, fecha_aplicacion, fecha_proxima, lote)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idMascota, idVacuna, idVeterinario, fechaAplicacion, fechaProximaStr, lote?.trim() || null]
    );

    res.status(201).json({
      id: result.insertId,
      idMascota: parseInt(idMascota),
      idVacuna: parseInt(idVacuna),
      idVeterinario,
      fechaAplicacion,
      fechaProximaDosis: fechaProximaStr,
      lote: lote?.trim() || null,
      mensaje: "Vacuna registrada exitosamente."
    });
  } catch (error) {
    console.error("[vacunas.POST aplicar] Error:", error);
    res.status(500).json({ error: "Error al registrar la vacunación." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/vacunas/mascota/:id
//  Historial de vacunas de una mascota específica.
// ═══════════════════════════════════════════════════════════════
router.get("/mascota/:id", soloStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT v_h.id, v.nombre AS vacunaNombre,
              DATE_FORMAT(v_h.fecha_aplicacion, '%Y-%m-%d') AS fechaAplicacion,
              DATE_FORMAT(v_h.fecha_proxima, '%Y-%m-%d') AS fechaProxima,
              v_h.lote, u.nombre AS veterinarioNombre
       FROM vacunaciones v_h
       INNER JOIN vacunas v ON v.id = v_h.id_vacuna
       INNER JOIN usuarios u ON u.id = v_h.id_veterinario
       WHERE v_h.id_mascota = ?
       ORDER BY v_h.fecha_aplicacion DESC`,
      [id]
    );
    res.json(rows);
  } catch (error) {
    console.error("[vacunas.GET mascota] Error:", error);
    res.status(500).json({ error: "Error al obtener historial de vacunación." });
  }
});

export default router;
