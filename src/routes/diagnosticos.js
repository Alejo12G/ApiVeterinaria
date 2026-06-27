import express from "express";
import { pool } from "../config/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { db } from "../config/firebase.js";

const router = express.Router();
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════
//  Helper: crear notificación (Firestore con fallback a MySQL)
// ═══════════════════════════════════════════════════════════════
async function crearNotificacion({ idUsuario, tipo, titulo, mensaje }) {
  const notif = {
    idUsuario,
    tipo,
    titulo,
    mensaje,
    leida: false,
    fechaEnvio: new Date().toISOString(),
  };

  if (db) {
    // Firestore
    await db.collection("notificaciones").add(notif);
  } else {
    // Fallback MySQL
    await pool.execute(
      `INSERT INTO notificaciones (id_usuario, tipo, titulo, mensaje, leida, fecha_envio)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [idUsuario, tipo, titulo, mensaje]
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  POST /api/diagnosticos
//  Crea un diagnóstico y cambia la cita a 'completada'.
//  Solo veterinario asignado o administrador.
//  Body: { citaId, sintomas, diagnostico, observaciones }
// ═══════════════════════════════════════════════════════════════
router.post("/", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const rol    = req.user.rol;
    const { citaId, sintomas, diagnostico, observaciones } = req.body;

    if (!citaId || !sintomas?.trim() || !diagnostico?.trim()) {
      conn.release();
      return res.status(400).json({
        error: "citaId, síntomas y diagnóstico son obligatorios.",
      });
    }

    // Verificar la cita y permisos
    const [citas] = await conn.execute(
      `SELECT c.id, c.id_veterinario, c.id_usuario, c.estado, c.id_mascota
       FROM citas c WHERE c.id = ?`,
      [citaId]
    );

    if (citas.length === 0) {
      conn.release();
      return res.status(404).json({ error: "La cita no existe." });
    }

    const cita = citas[0];

    if (rol !== "administrador" && cita.id_veterinario !== userId) {
      conn.release();
      return res.status(403).json({ error: "No tienes permiso sobre esta cita." });
    }

    if (cita.estado !== "programada" && cita.estado !== "confirmada") {
      conn.release();
      return res.status(400).json({
        error: `La cita ya tiene estado '${cita.estado}' y no puede registrar diagnóstico.`,
      });
    }

    if (!cita.id_mascota) {
      conn.release();
      return res.status(400).json({
        error: "Debes asignar una mascota a la cita antes de registrar el diagnóstico.",
      });
    }

    // Verificar que no tenga diagnóstico previo (unique por cita)
    const [prev] = await conn.execute(
      `SELECT id FROM diagnosticos WHERE id_cita = ?`,
      [citaId]
    );
    if (prev.length > 0) {
      conn.release();
      return res.status(409).json({ error: "Esta cita ya tiene un diagnóstico registrado." });
    }

    await conn.beginTransaction();

    // Insertar en tabla diagnosticos
    const [diagResult] = await conn.execute(
      `INSERT INTO diagnosticos (id_cita, id_veterinario, sintomas, diagnostico, observaciones, fecha)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [citaId, userId, sintomas.trim(), diagnostico.trim(), observaciones?.trim() || null]
    );

    // Cambiar estado de la cita a 'completada'
    await conn.execute(
      `UPDATE citas SET estado = 'completada' WHERE id = ?`,
      [citaId]
    );

    await conn.commit();
    conn.release();

    // Notificar al cliente
    try {
      await crearNotificacion({
        idUsuario: cita.id_usuario,
        tipo: "cita",
        titulo: "Consulta finalizada",
        mensaje: `Tu consulta (cita #${citaId}) ha sido completada. Diagnóstico registrado.`,
      });
    } catch (ne) {
      console.warn("[diagnosticos.POST] No se pudo enviar notificación:", ne.message);
    }

    res.status(201).json({
      id: diagResult.insertId,
      citaId: parseInt(citaId),
      sintomas: sintomas.trim(),
      diagnostico: diagnostico.trim(),
      observaciones: observaciones?.trim() || null,
      idVeterinario: userId,
      mensaje: "Diagnóstico registrado y cita marcada como completada.",
    });
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error("[diagnosticos.POST] Error:", error);
    res.status(500).json({ error: "Error al registrar el diagnóstico." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/diagnosticos/cita/:citaId
//  Obtiene el diagnóstico de una cita (con tratamientos).
//  Solo veterinario asignado o administrador.
// ═══════════════════════════════════════════════════════════════
router.get("/cita/:citaId", async (req, res) => {
  try {
    const userId    = req.user.id;
    const rol       = req.user.rol;
    const { citaId } = req.params;

    // Verificar permisos sobre la cita
    const [citas] = await pool.execute(
      `SELECT id_veterinario FROM citas WHERE id = ?`,
      [citaId]
    );

    if (citas.length === 0)
      return res.status(404).json({ error: "La cita no existe." });

    if (rol !== "administrador" && citas[0].id_veterinario !== userId)
      return res.status(403).json({ error: "No tienes permiso sobre esta cita." });

    const [diags] = await pool.execute(
      `SELECT d.id, d.id_cita AS citaId, d.id_veterinario AS idVeterinario,
              d.sintomas, d.diagnostico, d.observaciones,
              DATE_FORMAT(d.fecha, '%Y-%m-%dT%H:%i:%s') AS fecha
       FROM diagnosticos d
       WHERE d.id_cita = ?`,
      [citaId]
    );

    if (diags.length === 0)
      return res.json(null);

    const diag = diags[0];

    // Cargar tratamientos del diagnóstico
    const [tratamientos] = await pool.execute(
      `SELECT t.id, t.id_medicamento AS idMedicamento, m.nombre AS medicamentoNombre,
              t.dosis, t.frecuencia, t.duracion_dias AS duracionDias,
              t.instrucciones, t.estado,
              DATE_FORMAT(t.fecha_inicio, '%Y-%m-%d') AS fechaInicio,
              DATE_FORMAT(t.fecha_fin, '%Y-%m-%d') AS fechaFin
       FROM tratamientos t
       INNER JOIN medicamentos m ON m.id = t.id_medicamento
       WHERE t.id_diagnostico = ?
       ORDER BY t.fecha_inicio DESC`,
      [diag.id]
    );

    res.json({ ...diag, tratamientos });
  } catch (error) {
    console.error("[diagnosticos.GET /cita/:id] Error:", error);
    res.status(500).json({ error: "Error al obtener el diagnóstico." });
  }
});

export default router;
export { crearNotificacion };
