import express from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════
//  Middleware: solo veterinarios o administradores
// ═══════════════════════════════════════════════════════════
function soloStaff(req, res, next) {
  const rol = req.user?.rol;
  if (rol !== "veterinario" && rol !== "administrador") {
    return res
      .status(403)
      .json({ error: "Acceso denegado: solo veterinarios o administradores." });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
//  GET /api/especies
//  Retorna todas las especies.
//  Acceso: cualquier usuario autenticado.
// ═══════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const [especies] = await pool.execute(
      `SELECT id,
              nombre_comun      AS nombre,
              nombre_cientifico AS nombreCientifico,
              caracteristicas
       FROM especies
       ORDER BY nombre_comun ASC`
    );
    res.json(especies);
  } catch (error) {
    console.error("Error al obtener especies:", error);
    res.status(500).json({ error: "Error al obtener las especies" });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/especies
//  Crea una nueva especie.
//  Acceso: solo veterinario o administrador.
//  Body: { nombre, nombreCientifico?, caracteristicas? }
// ═══════════════════════════════════════════════════════════
router.post("/", soloStaff, async (req, res) => {
  try {
    const { nombre, nombreCientifico, caracteristicas } = req.body;

    if (!nombre || nombre.trim() === "") {
      return res
        .status(400)
        .json({ error: "El nombre común de la especie es obligatorio." });
    }

    // Verificar que no exista ya una especie con el mismo nombre
    const [existentes] = await pool.execute(
      `SELECT id FROM especies WHERE LOWER(nombre_comun) = LOWER(?)`,
      [nombre.trim()]
    );
    if (existentes.length > 0) {
      return res
        .status(409)
        .json({ error: "Ya existe una especie con ese nombre." });
    }

    const [result] = await pool.execute(
      `INSERT INTO especies (nombre_comun, nombre_cientifico, caracteristicas)
       VALUES (?, ?, ?)`,
      [
        nombre.trim(),
        nombreCientifico?.trim() || null,
        caracteristicas?.trim() || null,
      ]
    );

    res.status(201).json({
      id: result.insertId,
      nombre: nombre.trim(),
      nombreCientifico: nombreCientifico?.trim() || null,
      caracteristicas: caracteristicas?.trim() || null,
    });
  } catch (error) {
    console.error("Error al crear especie:", error);
    res.status(500).json({ error: "Error al crear la especie" });
  }
});

// ═══════════════════════════════════════════════════════════
//  PUT /api/especies/:id
//  Edita una especie existente.
//  Acceso: solo veterinario o administrador.
//  Body: { nombre, nombreCientifico?, caracteristicas? }
// ═══════════════════════════════════════════════════════════
router.put("/:id", soloStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, nombreCientifico, caracteristicas } = req.body;

    if (!nombre || nombre.trim() === "") {
      return res
        .status(400)
        .json({ error: "El nombre común de la especie es obligatorio." });
    }

    // Verificar que la especie exista
    const [existentes] = await pool.execute(
      `SELECT id FROM especies WHERE id = ?`,
      [id]
    );
    if (existentes.length === 0) {
      return res.status(404).json({ error: "Especie no encontrada." });
    }

    // Verificar nombre duplicado (excluyendo la misma especie)
    const [duplicado] = await pool.execute(
      `SELECT id FROM especies WHERE LOWER(nombre_comun) = LOWER(?) AND id != ?`,
      [nombre.trim(), id]
    );
    if (duplicado.length > 0) {
      return res
        .status(409)
        .json({ error: "Ya existe otra especie con ese nombre." });
    }

    await pool.execute(
      `UPDATE especies
       SET nombre_comun      = ?,
           nombre_cientifico = ?,
           caracteristicas   = ?
       WHERE id = ?`,
      [
        nombre.trim(),
        nombreCientifico?.trim() || null,
        caracteristicas?.trim() || null,
        id,
      ]
    );

    res.json({
      id: parseInt(id),
      nombre: nombre.trim(),
      nombreCientifico: nombreCientifico?.trim() || null,
      caracteristicas: caracteristicas?.trim() || null,
    });
  } catch (error) {
    console.error("Error al actualizar especie:", error);
    res.status(500).json({ error: "Error al actualizar la especie" });
  }
});

// ═══════════════════════════════════════════════════════════
//  DELETE /api/especies/:id
//  Elimina una especie si no tiene mascotas asociadas.
//  Acceso: solo veterinario o administrador.
// ═══════════════════════════════════════════════════════════
router.delete("/:id", soloStaff, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la especie exista
    const [existentes] = await pool.execute(
      `SELECT id FROM especies WHERE id = ?`,
      [id]
    );
    if (existentes.length === 0) {
      return res.status(404).json({ error: "Especie no encontrada." });
    }

    // Verificar que no tenga mascotas asociadas
    const [mascotas] = await pool.execute(
      `SELECT COUNT(*) AS total FROM mascotas WHERE id_especie = ?`,
      [id]
    );
    if (mascotas[0].total > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: hay ${mascotas[0].total} mascota(s) registrada(s) con esta especie.`,
      });
    }

    await pool.execute(`DELETE FROM especies WHERE id = ?`, [id]);

    res.json({ mensaje: "Especie eliminada correctamente." });
  } catch (error) {
    console.error("Error al eliminar especie:", error);
    res.status(500).json({ error: "Error al eliminar la especie" });
  }
});

export default router;
