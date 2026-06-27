import express from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════
//  Middleware: solo administradores
// ═══════════════════════════════════════════════════════════
function soloAdmin(req, res, next) {
  if (req.user?.rol !== "administrador") {
    return res
      .status(403)
      .json({ error: "Acceso denegado: solo administradores." });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
//  GET /api/inventario
//  Lista todos los medicamentos con su stock actual (LEFT JOIN).
//  Un medicamento puede no tener fila en inventarios aún.
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.get("/", soloAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         m.id,
         m.nombre,
         m.tipo,
         m.descripcion,
         m.contraindicaciones,
         m.fabricante,
         m.precio,
         COALESCE(i.id, NULL)                AS inventarioId,
         COALESCE(i.cantidad, 0)             AS cantidad,
         COALESCE(i.cantidad_minima, 5)      AS cantidadMinima,
         i.fecha_vencimiento                 AS fechaVencimiento,
         i.lote,
         i.fecha_actualizacion               AS fechaActualizacion
       FROM medicamentos m
       LEFT JOIN inventarios i ON i.id_medicamento = m.id
       ORDER BY m.nombre ASC`
    );

    const data = rows.map(r => ({
      ...r,
      precio: parseFloat(r.precio),
      stockBajo: r.cantidad <= r.cantidadMinima,
      vencido: r.fechaVencimiento
        ? new Date(r.fechaVencimiento) < new Date()
        : false,
    }));

    res.json(data);
  } catch (error) {
    console.error("[inventario.GET /] Error:", error);
    res.status(500).json({ error: "Error al obtener el inventario." });
  }
});

// ═══════════════════════════════════════════════════════════
//  GET /api/inventario/alertas
//  Retorna medicamentos con stock bajo o vencidos.
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.get("/alertas", soloAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         m.id,
         m.nombre,
         m.tipo,
         COALESCE(i.cantidad, 0)        AS cantidad,
         COALESCE(i.cantidad_minima, 5) AS cantidadMinima,
         i.fecha_vencimiento            AS fechaVencimiento,
         i.lote
       FROM medicamentos m
       LEFT JOIN inventarios i ON i.id_medicamento = m.id
       WHERE COALESCE(i.cantidad, 0) <= COALESCE(i.cantidad_minima, 5)
          OR (i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento < CURDATE())
       ORDER BY m.nombre ASC`
    );

    res.json(rows.map(r => ({
      ...r,
      stockBajo: r.cantidad <= r.cantidadMinima,
      vencido: r.fechaVencimiento
        ? new Date(r.fechaVencimiento) < new Date()
        : false,
    })));
  } catch (error) {
    console.error("[inventario.GET /alertas] Error:", error);
    res.status(500).json({ error: "Error al obtener alertas de inventario." });
  }
});

// ═══════════════════════════════════════════════════════════
//  POST /api/inventario/medicamentos
//  Crea un medicamento y su entrada de inventario en una transacción.
//  Body: { nombre, tipo, descripcion?, contraindicaciones?,
//          fabricante?, precio, cantidad, cantidadMinima?,
//          fechaVencimiento?, lote? }
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.post("/medicamentos", soloAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      nombre, tipo, descripcion, contraindicaciones,
      fabricante, precio,
      cantidad = 0, cantidadMinima = 5,
      fechaVencimiento, lote,
    } = req.body;

    // Validaciones
    if (!nombre?.trim()) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: "El nombre del medicamento es obligatorio." });
    }
    if (!tipo?.trim()) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: "El tipo de medicamento es obligatorio." });
    }
    if (precio === undefined || precio === null || isNaN(parseFloat(precio)) || parseFloat(precio) < 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: "El precio debe ser un número válido." });
    }

    // Verificar nombre duplicado
    const [dup] = await conn.execute(
      `SELECT id FROM medicamentos WHERE LOWER(nombre) = LOWER(?)`,
      [nombre.trim()]
    );
    if (dup.length > 0) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ error: "Ya existe un medicamento con ese nombre." });
    }

    // Insertar medicamento
    const [medResult] = await conn.execute(
      `INSERT INTO medicamentos (nombre, tipo, descripcion, contraindicaciones, fabricante, precio)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nombre.trim(),
        tipo.trim(),
        descripcion?.trim() || null,
        contraindicaciones?.trim() || null,
        fabricante?.trim() || null,
        parseFloat(precio),
      ]
    );
    const idMedicamento = medResult.insertId;

    // Insertar fila de inventario
    const [invResult] = await conn.execute(
      `INSERT INTO inventarios (id_medicamento, cantidad, cantidad_minima, fecha_vencimiento, lote)
       VALUES (?, ?, ?, ?, ?)`,
      [
        idMedicamento,
        parseInt(cantidad) || 0,
        parseInt(cantidadMinima) || 5,
        fechaVencimiento || null,
        lote?.trim() || null,
      ]
    );

    await conn.commit();
    conn.release();

    res.status(201).json({
      id: idMedicamento,
      inventarioId: invResult.insertId,
      nombre: nombre.trim(),
      tipo: tipo.trim(),
      descripcion: descripcion?.trim() || null,
      contraindicaciones: contraindicaciones?.trim() || null,
      fabricante: fabricante?.trim() || null,
      precio: parseFloat(precio),
      cantidad: parseInt(cantidad) || 0,
      cantidadMinima: parseInt(cantidadMinima) || 5,
      fechaVencimiento: fechaVencimiento || null,
      lote: lote?.trim() || null,
      stockBajo: (parseInt(cantidad) || 0) <= (parseInt(cantidadMinima) || 5),
      vencido: false,
    });
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error("[inventario.POST /medicamentos] Error:", error);
    res.status(500).json({ error: "Error al crear el medicamento." });
  }
});

// ═══════════════════════════════════════════════════════════
//  PUT /api/inventario/medicamentos/:id
//  Edita datos del medicamento (sin tocar el stock).
//  Body: { nombre, tipo, descripcion?, contraindicaciones?,
//          fabricante?, precio }
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.put("/medicamentos/:id", soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, tipo, descripcion, contraindicaciones, fabricante, precio } = req.body;

    if (!nombre?.trim())
      return res.status(400).json({ error: "El nombre es obligatorio." });
    if (!tipo?.trim())
      return res.status(400).json({ error: "El tipo es obligatorio." });
    if (precio === undefined || isNaN(parseFloat(precio)) || parseFloat(precio) < 0)
      return res.status(400).json({ error: "El precio debe ser un número válido." });

    // Existe?
    const [exists] = await pool.execute(`SELECT id FROM medicamentos WHERE id = ?`, [id]);
    if (exists.length === 0)
      return res.status(404).json({ error: "Medicamento no encontrado." });

    // Nombre duplicado (excluyendo el mismo)
    const [dup] = await pool.execute(
      `SELECT id FROM medicamentos WHERE LOWER(nombre) = LOWER(?) AND id != ?`,
      [nombre.trim(), id]
    );
    if (dup.length > 0)
      return res.status(409).json({ error: "Ya existe otro medicamento con ese nombre." });

    await pool.execute(
      `UPDATE medicamentos
       SET nombre = ?, tipo = ?, descripcion = ?, contraindicaciones = ?, fabricante = ?, precio = ?
       WHERE id = ?`,
      [
        nombre.trim(),
        tipo.trim(),
        descripcion?.trim() || null,
        contraindicaciones?.trim() || null,
        fabricante?.trim() || null,
        parseFloat(precio),
        id,
      ]
    );

    res.json({
      id: parseInt(id),
      nombre: nombre.trim(),
      tipo: tipo.trim(),
      descripcion: descripcion?.trim() || null,
      contraindicaciones: contraindicaciones?.trim() || null,
      fabricante: fabricante?.trim() || null,
      precio: parseFloat(precio),
    });
  } catch (error) {
    console.error("[inventario.PUT /medicamentos/:id] Error:", error);
    res.status(500).json({ error: "Error al actualizar el medicamento." });
  }
});

// ═══════════════════════════════════════════════════════════
//  PUT /api/inventario/stock/:idMedicamento
//  Actualiza el stock de un medicamento (cantidad, lote, vencimiento).
//  Body: { cantidad, cantidadMinima?, fechaVencimiento?, lote? }
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.put("/stock/:idMedicamento", soloAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { idMedicamento } = req.params;
    const { cantidad, cantidadMinima, fechaVencimiento, lote } = req.body;

    if (cantidad === undefined || isNaN(parseInt(cantidad)) || parseInt(cantidad) < 0)
      return res.status(400).json({ error: "La cantidad debe ser un número entero >= 0." });

    // Verificar que el medicamento exista
    const [med] = await conn.execute(`SELECT id FROM medicamentos WHERE id = ?`, [idMedicamento]);
    if (med.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Medicamento no encontrado." });
    }

    // ¿Ya tiene fila de inventario?
    const [inv] = await conn.execute(
      `SELECT id FROM inventarios WHERE id_medicamento = ?`,
      [idMedicamento]
    );

    if (inv.length === 0) {
      // Crear fila de inventario si no existe
      await conn.execute(
        `INSERT INTO inventarios (id_medicamento, cantidad, cantidad_minima, fecha_vencimiento, lote)
         VALUES (?, ?, ?, ?, ?)`,
        [idMedicamento, parseInt(cantidad), parseInt(cantidadMinima) || 5, fechaVencimiento || null, lote?.trim() || null]
      );
    } else {
      await conn.execute(
        `UPDATE inventarios
         SET cantidad         = ?,
             cantidad_minima  = COALESCE(?, cantidad_minima),
             fecha_vencimiento = ?,
             lote             = ?
         WHERE id_medicamento = ?`,
        [
          parseInt(cantidad),
          cantidadMinima !== undefined ? parseInt(cantidadMinima) : null,
          fechaVencimiento || null,
          lote?.trim() || null,
          idMedicamento,
        ]
      );
    }

    conn.release();
    res.json({ mensaje: "Stock actualizado correctamente." });
  } catch (error) {
    conn.release();
    console.error("[inventario.PUT /stock/:id] Error:", error);
    res.status(500).json({ error: "Error al actualizar el stock." });
  }
});

// ═══════════════════════════════════════════════════════════
//  DELETE /api/inventario/medicamentos/:id
//  Elimina un medicamento (el inventario se borra por CASCADE).
//  Falla si el medicamento tiene tratamientos activos.
//  Acceso: solo administrador.
// ═══════════════════════════════════════════════════════════
router.delete("/medicamentos/:id", soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [exists] = await pool.execute(`SELECT id FROM medicamentos WHERE id = ?`, [id]);
    if (exists.length === 0)
      return res.status(404).json({ error: "Medicamento no encontrado." });

    // Verificar tratamientos activos
    const [trat] = await pool.execute(
      `SELECT COUNT(*) AS total FROM tratamientos WHERE id_medicamento = ? AND estado = 'activo'`,
      [id]
    );
    if (trat[0].total > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: hay ${trat[0].total} tratamiento(s) activo(s) con este medicamento.`,
      });
    }

    await pool.execute(`DELETE FROM medicamentos WHERE id = ?`, [id]);
    res.json({ mensaje: "Medicamento eliminado correctamente." });
  } catch (error) {
    console.error("[inventario.DELETE /medicamentos/:id] Error:", error);
    res.status(500).json({ error: "Error al eliminar el medicamento." });
  }
});

export default router;
