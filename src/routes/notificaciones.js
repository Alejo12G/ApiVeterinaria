import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { db } from "../config/firebase.js";
import { pool } from "../config/database.js";

const router = express.Router();
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════
//  GET /api/notificaciones
//  Lista las notificaciones del usuario logueado (desde Firestore o MySQL)
// ═══════════════════════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const idUsuario = req.user.id;
    let notifs = [];

    if (db) {
      // Leer desde Firestore sin orderBy para no exigir índice compuesto
      const snapshot = await db.collection("notificaciones")
        .where("idUsuario", "==", idUsuario)
        .get();

      snapshot.forEach(doc => {
        notifs.push({
          id: doc.id,
          ...doc.data()
        });
      });
      notifs.sort((a, b) => new Date(b.fechaEnvio) - new Date(a.fechaEnvio));
    } else {
      // Fallback MySQL
      const [rows] = await pool.execute(
        `SELECT id, tipo, titulo, mensaje, leida, fecha_envio AS fechaEnvio
         FROM notificaciones
         WHERE id_usuario = ?
         ORDER BY fecha_envio DESC`,
        [idUsuario]
      );
      notifs = rows.map(r => ({ ...r, leida: r.leida === 1 }));
    }

    res.json(notifs);
  } catch (error) {
    console.error("[notificaciones.GET] Error:", error);
    res.status(500).json({ error: "Error al obtener notificaciones." });
  }
});

// ═══════════════════════════════════════════════════════════════
//  PATCH /api/notificaciones/:id/leer
//  Marca una notificación como leída
// ═══════════════════════════════════════════════════════════════
router.patch("/:id/leer", async (req, res) => {
  try {
    const { id } = req.params;
    const idUsuario = req.user.id;

    if (db) {
      // Firestore (verificar pertenencia es buena práctica, pero aquí lo haremos directo o por ref)
      const docRef = db.collection("notificaciones").doc(id);
      const doc = await docRef.get();
      if (!doc.exists || doc.data().idUsuario !== idUsuario) {
        return res.status(403).json({ error: "No tienes permiso o no existe." });
      }
      await docRef.update({ leida: true });
    } else {
      // MySQL
      await pool.execute(
        `UPDATE notificaciones SET leida = 1 WHERE id = ? AND id_usuario = ?`,
        [id, idUsuario]
      );
    }

    res.json({ mensaje: "Notificación marcada como leída.", id });
  } catch (error) {
    console.error("[notificaciones.PATCH leer] Error:", error);
    res.status(500).json({ error: "Error al marcar como leída." });
  }
});

export default router;
