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
//  POST /api/tratamientos
//  Crea un tratamiento para un diagnóstico. Descuenta stock.
//  Body: { idDiagnostico, idMedicamento, dosis, frecuencia,
//           duracionDias, instrucciones?, fechaInicio }
//  Acceso: veterinario / administrador
// ═══════════════════════════════════════════════════════════════
router.post("/", soloStaff, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const {
      idDiagnostico, idMedicamento, dosis, frecuencia,
      duracionDias, instrucciones, fechaInicio
    } = req.body;

    if (!idDiagnostico || !idMedicamento || !dosis || !frecuencia || !duracionDias || !fechaInicio) {
      conn.release();
      return res.status(400).json({
        error: "idDiagnostico, idMedicamento, dosis, frecuencia, duracionDias y fechaInicio son obligatorios.",
      });
    }

    // Verificar que el diagnóstico exista
    const [diags] = await conn.execute(
      `SELECT id FROM diagnosticos WHERE id = ?`,
      [idDiagnostico]
    );
    if (diags.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Diagnóstico no encontrado." });
    }

    // Verificar medicamento y stock
    const [invRows] = await conn.execute(
      `SELECT i.id AS invId, i.cantidad
       FROM inventarios i WHERE i.id_medicamento = ?`,
      [idMedicamento]
    );

    if (invRows.length === 0 || invRows[0].cantidad <= 0) {
      conn.release();
      return res.status(409).json({
        error: "El medicamento no tiene stock disponible en inventario.",
      });
    }

    // Calcular fecha de fin
    const inicio = new Date(fechaInicio);
    const fin    = new Date(inicio);
    fin.setDate(fin.getDate() + parseInt(duracionDias));
    const fechaFinStr = fin.toISOString().split("T")[0];

    await conn.beginTransaction();

    // Insertar tratamiento
    const [trat] = await conn.execute(
      `INSERT INTO tratamientos
         (id_diagnostico, id_medicamento, dosis, frecuencia, duracion_dias,
          instrucciones, estado, fecha_inicio, fecha_fin)
       VALUES (?, ?, ?, ?, ?, ?, 'activo', ?, ?)`,
      [
        idDiagnostico, idMedicamento, dosis.trim(), frecuencia.trim(),
        parseInt(duracionDias), instrucciones?.trim() || null,
        fechaInicio, fechaFinStr,
      ]
    );

    // Descontar 1 unidad del inventario (TC-007)
    await conn.execute(
      `UPDATE inventarios SET cantidad = GREATEST(cantidad - 1, 0)
       WHERE id_medicamento = ?`,
      [idMedicamento]
    );

    await conn.commit();
    conn.release();

    res.status(201).json({
      id: trat.insertId,
      idDiagnostico: parseInt(idDiagnostico),
      idMedicamento: parseInt(idMedicamento),
      dosis: dosis.trim(),
      frecuencia: frecuencia.trim(),
      duracionDias: parseInt(duracionDias),
      instrucciones: instrucciones?.trim() || null,
      estado: "activo",
      fechaInicio,
      fechaFin: fechaFinStr,
    });
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error("[tratamientos.POST] Error:", error);
    res.status(500).json({ error: "Error al crear el tratamiento." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/tratamientos/diagnostico/:diagId
//  Lista los tratamientos de un diagnóstico.
//  Acceso: veterinario / administrador
// ═══════════════════════════════════════════════════════════════
router.get("/diagnostico/:diagId", soloStaff, async (req, res) => {
  try {
    const { diagId } = req.params;

    const [rows] = await pool.execute(
      `SELECT t.id, t.id_diagnostico AS idDiagnostico,
              t.id_medicamento AS idMedicamento, m.nombre AS medicamentoNombre,
              t.dosis, t.frecuencia, t.duracion_dias AS duracionDias,
              t.instrucciones, t.estado,
              DATE_FORMAT(t.fecha_inicio, '%Y-%m-%d') AS fechaInicio,
              DATE_FORMAT(t.fecha_fin, '%Y-%m-%d') AS fechaFin
       FROM tratamientos t
       INNER JOIN medicamentos m ON m.id = t.id_medicamento
       WHERE t.id_diagnostico = ?
       ORDER BY t.fecha_inicio DESC`,
      [diagId]
    );

    res.json(rows);
  } catch (error) {
    console.error("[tratamientos.GET] Error:", error);
    res.status(500).json({ error: "Error al obtener tratamientos." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  PATCH /api/tratamientos/:id/estado
//  Cambia el estado de un tratamiento (completado/cancelado).
//  Acceso: veterinario / administrador
// ═══════════════════════════════════════════════════════════════
router.patch("/:id/estado", soloStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ["activo", "completado", "cancelado"];
    if (!estadosValidos.includes(estado))
      return res.status(400).json({ error: `Estado inválido. Valores: ${estadosValidos.join(", ")}` });

    const [r] = await pool.execute(
      `UPDATE tratamientos SET estado = ? WHERE id = ?`,
      [estado, id]
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ error: "Tratamiento no encontrado." });

    res.json({ mensaje: "Estado actualizado.", estado });
  } catch (error) {
    console.error("[tratamientos.PATCH estado] Error:", error);
    res.status(500).json({ error: "Error al actualizar el estado." });
  }
});

export default router;
