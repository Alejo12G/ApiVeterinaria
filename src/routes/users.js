import express from "express";
import {pool} from "../config/database.js";
import {authenticateToken} from "../middleware/auth.js";

const router=express.Router();
router.use(authenticateToken);
// 3. Obtener la lista de veterinarios activos
router.get("/veterinarios", authenticateToken, async (req, res) => {
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


export default router;